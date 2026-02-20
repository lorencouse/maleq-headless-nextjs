/**
 * Executor — Phase 4: Execute the planned actions against the database.
 *
 * Each action runs in its own transaction. Supports checkpointing for resumption.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type {
  PipelinePlan, PlannedAction, ExecutionResult, ExecutionLog,
  VariantCheckpoint, FeedIndex, VariantManagerOptions, SnapshotVariation,
  NewParentInfo,
} from './types';
import {
  createParentProduct, moveVariationsToParent, deleteVariations,
  setParentDraft, updateVariationAttribute, updateParentProductAttributes,
  ensureAttributeTerm, linkTermToProduct, updateMetaLookup,
  buildProductAttributesMeta,
} from './db-mutations';
import { toSlug } from './utils';
import { resolveFeedProduct } from './feed-index';
import { stripParentNameFromValue, buildSizeFromFeed, classifyValue, extractDifferentiator } from './classification';

const CHECKPOINT_DIR = join(process.cwd(), 'scripts', 'output');
const CHECKPOINT_FILE = join(CHECKPOINT_DIR, 'variant-checkpoint.json');
const CHECKPOINT_INTERVAL = 10;
const ERROR_BUDGET_BATCH = 10;
const ERROR_BUDGET_THRESHOLD = 0.2;

/**
 * Execute a pipeline plan (or subset of it).
 */
export async function executePlan(
  db: Connection,
  plan: PipelinePlan,
  feedIndex: FeedIndex,
  opts: VariantManagerOptions
): Promise<ExecutionLog> {
  console.log('\n--- Phase 4: Executing plan ---');

  let checkpoint = opts.resume ? loadCheckpoint(plan) : null;
  const completedSet = new Set(checkpoint?.completedActionIndices || []);

  // Filter actions by confidence and type
  let actions = plan.actions.filter(a => a.confidence >= opts.minConfidence);
  if (opts.actionTypes && opts.actionTypes.length > 0) {
    const allowedTypes = new Set(opts.actionTypes);
    actions = actions.filter(a => allowedTypes.has(a.type));
  }

  console.log(`  ${actions.length} actions to execute (${completedSet.size} already completed)`);

  const results: ExecutionResult[] = [];
  let batchErrors = 0;
  let batchCount = 0;

  // Track parents that were split — postSplitCleanup already handles
  // fix-duplicate-attrs, reduce-to-single-attr, and reclassify-attribute
  const splitParentIds = new Set<number>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const actionIndex = plan.actions.indexOf(action);

    // Skip if already completed
    if (completedSet.has(actionIndex)) {
      if (opts.verbose) console.log(`  [skip] Action #${actionIndex} already completed`);
      continue;
    }

    // Skip if parent already processed (for single-parent filter)
    if (opts.parentId && action.parentId !== opts.parentId) continue;

    // Skip attr-fix actions for parents that were already split
    // (postSplitCleanup handles these inline during the split)
    const POST_SPLIT_HANDLED = new Set(['fix-duplicate-attrs', 'reduce-to-single-attr', 'reclassify-attribute']);
    if (POST_SPLIT_HANDLED.has(action.type) && splitParentIds.has(action.parentId)) {
      if (opts.verbose) console.log(`  [skip] Action #${actionIndex} ${action.type} — parent #${action.parentId} already cleaned up during split`);
      completedSet.add(actionIndex);
      continue;
    }

    if (opts.verbose) {
      console.log(`  [${actionIndex}] ${action.type} on #${action.parentId} "${action.parentTitle}" (conf=${action.confidence.toFixed(2)})`);
    }

    const result = await executeAction(db, action, actionIndex, feedIndex, opts);
    results.push(result);
    batchCount++;

    if (result.success) {
      completedSet.add(actionIndex);
      if (action.type === 'split-product-lines') {
        splitParentIds.add(action.parentId);
      }
    } else {
      batchErrors++;
      console.error(`  [FAIL] Action #${actionIndex}: ${result.error}`);
    }

    // Checkpoint every N actions
    if (batchCount % CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint(plan, completedSet, results);
    }

    // Error budget check
    if (batchCount % ERROR_BUDGET_BATCH === 0 && batchCount > 0) {
      const recentErrors = results.slice(-ERROR_BUDGET_BATCH).filter(r => !r.success).length;
      if (recentErrors / ERROR_BUDGET_BATCH > ERROR_BUDGET_THRESHOLD) {
        console.error(`\n  ERROR BUDGET EXCEEDED: ${recentErrors}/${ERROR_BUDGET_BATCH} recent failures. Stopping.`);
        break;
      }
    }
  }

  // Final checkpoint
  saveCheckpoint(plan, completedSet, results);

  const log: ExecutionLog = {
    timestamp: new Date().toISOString(),
    mode: opts.mode,
    results,
    summary: {
      total: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      skipped: actions.length - results.length,
    },
  };

  console.log(`\n  Execution complete: ${log.summary.succeeded} succeeded, ${log.summary.failed} failed, ${log.summary.skipped} skipped`);
  return log;
}

/**
 * Execute a single action within a transaction.
 */
async function executeAction(
  db: Connection,
  action: PlannedAction,
  actionIndex: number,
  feedIndex: FeedIndex,
  opts: VariantManagerOptions
): Promise<ExecutionResult> {
  const before = opts.mode === 'apply' ? await snapshotVariations(db, action.parentId) : undefined;
  let newParents: NewParentInfo[] | undefined;

  try {
    await db.beginTransaction();

    switch (action.type) {
      case 'convert-to-draft':
        await executeDraft(db, action);
        break;
      case 'delete-discontinued':
        await executeDeleteDiscontinued(db, action);
        break;
      case 'split-product-lines':
        newParents = await executeSplit(db, action, feedIndex, opts);
        break;
      case 'fix-duplicate-attrs':
        await executeFixDuplicates(db, action, feedIndex);
        break;
      case 'reduce-to-single-attr':
        await executeReduceAttrs(db, action);
        break;
      case 'reclassify-attribute':
        await executeReclassify(db, action);
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    await db.commit();

    const after = opts.mode === 'apply' ? await snapshotVariations(db, action.parentId) : undefined;

    return { actionIndex, action, success: true, before, after, newParents };
  } catch (err) {
    await db.rollback();
    return {
      actionIndex,
      action,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      before,
    };
  }
}

// ==================== Action Executors ====================

async function executeDraft(db: Connection, action: PlannedAction): Promise<void> {
  await setParentDraft(db, action.parentId);
}

async function executeDeleteDiscontinued(db: Connection, action: PlannedAction): Promise<void> {
  if (!action.deleteVarIds || action.deleteVarIds.length === 0) return;
  await deleteVariations(db, action.deleteVarIds);
  await updateMetaLookup(db, action.parentId);
}

async function executeSplit(
  db: Connection,
  action: PlannedAction,
  feedIndex: FeedIndex,
  opts: VariantManagerOptions
): Promise<NewParentInfo[]> {
  if (!action.splitGroups || action.splitGroups.length <= 1) return [];

  const newParents: NewParentInfo[] = [];

  for (const group of action.splitGroups) {
    if (group.isKeepGroup) continue;

    // Create new parent
    const newParentId = await createParentProduct(
      db, action.parentId, group.newParentTitle, group.newParentSlug
    );

    // Move variations
    await moveVariationsToParent(db, group.variationIds, newParentId);

    // Post-split cleanup: fix duplicates, strip parent names, link terms
    await postSplitCleanup(db, newParentId, group.newParentTitle, feedIndex);

    // Update meta lookup
    await updateMetaLookup(db, newParentId);

    // Read back actual slug from DB (may have been deduplicated)
    const [postRow] = await db.query<RowDataPacket[]>(
      `SELECT post_title, post_name FROM wp_posts WHERE ID = ?`, [newParentId]
    );
    newParents.push({
      id: newParentId,
      title: postRow[0]?.post_title || group.newParentTitle,
      slug: postRow[0]?.post_name || group.newParentSlug,
      variationCount: group.variationIds.length,
    });
  }

  // Post-split cleanup for keep group
  const keepGroup = action.splitGroups.find(g => g.isKeepGroup);
  if (keepGroup) {
    await postSplitCleanup(db, action.parentId, action.parentTitle, feedIndex);
    await updateMetaLookup(db, action.parentId);
  }

  return newParents;
}

async function executeFixDuplicates(db: Connection, action: PlannedAction, feedIndex: FeedIndex): Promise<void> {
  if (!action.attrChanges) return;

  // Create needed terms and link to parent
  const termTaxIds = new Map<string, number>();
  if (action.newTermsNeeded) {
    for (const slug of action.newTermsNeeded) {
      const taxonomy = action.attrChanges[0]?.newKey.replace('attribute_', '') || 'pa_variant';
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const ttId = await ensureAttributeTerm(db, taxonomy, name, slug);
      termTaxIds.set(`${taxonomy}:${slug}`, ttId);
    }
  }

  // Apply attribute changes
  for (const change of action.attrChanges) {
    await updateVariationAttribute(db, change.variationId, change.oldKey, change.newKey, change.newSlug);
  }

  // Link all attribute terms to parent product
  await linkAllTermsToParent(db, action.parentId);

  // Update parent _product_attributes
  await rebuildParentAttributes(db, action.parentId);
}

async function executeReduceAttrs(db: Connection, action: PlannedAction): Promise<void> {
  if (!action.keepDimension || !action.removeDimension) return;

  const keepKey = `attribute_${action.keepDimension}`;
  const removeKeys = action.removeDimension.split(', ').map(t => `attribute_${t}`);

  // Remove extra attribute meta from variations
  for (const removeKey of removeKeys) {
    await db.query(`
      DELETE FROM wp_postmeta
      WHERE meta_key = ?
        AND post_id IN (
          SELECT v.ID FROM wp_posts v
          WHERE v.post_parent = ? AND v.post_type = 'product_variation'
        )
    `, [removeKey, action.parentId]);
  }

  // Rebuild parent _product_attributes
  await rebuildParentAttributes(db, action.parentId);
}

async function executeReclassify(db: Connection, action: PlannedAction): Promise<void> {
  if (!action.attrChanges || !action.reclassifyTo) return;

  // Create needed terms
  if (action.newTermsNeeded) {
    for (const slug of action.newTermsNeeded) {
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      await ensureAttributeTerm(db, action.reclassifyTo, name, slug);
    }
  }

  // Apply changes
  for (const change of action.attrChanges) {
    await updateVariationAttribute(db, change.variationId, change.oldKey, change.newKey, change.newSlug);
  }

  // Link all attribute terms to parent and rebuild
  await linkAllTermsToParent(db, action.parentId);
  await rebuildParentAttributes(db, action.parentId);
}

// ==================== Helpers ====================

/**
 * Post-split cleanup: strip parent names, fix remaining duplicate attrs,
 * reduce to single attribute, link terms, and rebuild parent attributes.
 */
async function postSplitCleanup(
  db: Connection,
  parentId: number,
  parentTitle: string,
  feedIndex: FeedIndex
): Promise<void> {
  // Load current variation attributes for this parent
  const [varRows] = await db.query<RowDataPacket[]>(`
    SELECT v.ID as id, pm.meta_key, pm.meta_value,
           sku.meta_value as sku, wt.meta_value as wt_sku
    FROM wp_posts v
    JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key LIKE 'attribute_pa_%'
    LEFT JOIN wp_postmeta sku ON sku.post_id = v.ID AND sku.meta_key = '_sku'
    LEFT JOIN wp_postmeta wt ON wt.post_id = v.ID AND wt.meta_key = '_wt_sku'
    WHERE v.post_parent = ? AND v.post_type = 'product_variation'
  `, [parentId]);

  if (varRows.length === 0) return;

  // Step 0: Reduce to single attribute if multiple keys exist
  const distinctKeys = new Set(varRows.map(r => r.meta_key));
  if (distinctKeys.size > 1) {
    await reduceToSingleAttribute(db, parentId, varRows, feedIndex);
    // Reload after reduction
    const [reloaded] = await db.query<RowDataPacket[]>(`
      SELECT v.ID as id, pm.meta_key, pm.meta_value,
             sku.meta_value as sku, wt.meta_value as wt_sku
      FROM wp_posts v
      JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key LIKE 'attribute_pa_%'
      LEFT JOIN wp_postmeta sku ON sku.post_id = v.ID AND sku.meta_key = '_sku'
      LEFT JOIN wp_postmeta wt ON wt.post_id = v.ID AND wt.meta_key = '_wt_sku'
      WHERE v.post_parent = ? AND v.post_type = 'product_variation'
    `, [parentId]);
    varRows.length = 0;
    varRows.push(...reloaded);
    if (varRows.length === 0) return;
  }

  const attrKey = varRows[0].meta_key;

  // Step 1: Strip parent name from attribute values
  for (const row of varRows) {
    const stripped = stripParentNameFromValue(row.meta_value, parentTitle);
    if (stripped && stripped !== row.meta_value) {
      const newSlug = toSlug(stripped);
      await updateVariationAttribute(db, row.id, row.meta_key, row.meta_key, newSlug);
      row.meta_value = newSlug;
    }
  }

  // Step 2: Detect remaining duplicates and fix using feed data
  const valueCounts = new Map<string, RowDataPacket[]>();
  for (const row of varRows) {
    if (!valueCounts.has(row.meta_value)) valueCounts.set(row.meta_value, []);
    valueCounts.get(row.meta_value)!.push(row);
  }

  for (const [, dupes] of valueCounts) {
    if (dupes.length <= 1) continue;

    // Collect feed data for all dupes
    const feedProducts = dupes.map(d => resolveFeedProduct(feedIndex, d.wt_sku || '', d.sku || ''));

    // Strategy A: If all dupes have distinct feed colors, switch to color
    const feedColors = feedProducts.map(f => f?.color || '');
    const uniqueColors = new Set(feedColors.filter(c => c));
    if (uniqueColors.size === dupes.length && feedColors.every(c => c)) {
      for (let i = 0; i < dupes.length; i++) {
        const classified = classifyValue(feedColors[i]);
        const newValue = toSlug(classified.normalized || feedColors[i]);
        await updateVariationAttribute(db, dupes[i].id, attrKey, 'attribute_pa_color', newValue);
        dupes[i].meta_key = 'attribute_pa_color';
        dupes[i].meta_value = newValue;
      }
      continue;
    }

    // Strategy A2: If feed names provide distinct differentiators, use them
    const feedNames = feedProducts.map(f => f?.name || '');
    if (feedNames.every(n => n)) {
      const diffs = feedNames.map((name, idx) => {
        const others = feedNames.filter((_, j) => j !== idx);
        return extractDifferentiator(name, others);
      });
      const diffValues = diffs.map(d => d ? toSlug(d.classified.normalized || d.text) : '');
      const uniqueDiffs = new Set(diffValues.filter(v => v));
      if (uniqueDiffs.size === dupes.length && diffValues.every(v => v)) {
        for (let i = 0; i < dupes.length; i++) {
          const classified = diffs[i]!.classified;
          const newKey = classified.type === 'color' ? 'attribute_pa_color'
                       : classified.type === 'size' ? 'attribute_pa_size'
                       : attrKey;
          await updateVariationAttribute(db, dupes[i].id, attrKey, newKey, diffValues[i]);
          dupes[i].meta_key = newKey;
          dupes[i].meta_value = diffValues[i];
        }
        continue;
      }
    }

    // Strategy B: If all dupes have distinct feed sizes, switch to size
    const feedSizes = feedProducts.map(f => f ? buildSizeFromFeed(f) : null);
    const uniqueSizes = new Set(feedSizes.filter(Boolean));
    if (uniqueSizes.size === dupes.length && feedSizes.every(Boolean)) {
      for (let i = 0; i < dupes.length; i++) {
        const newValue = toSlug(feedSizes[i]!);
        await updateVariationAttribute(db, dupes[i].id, attrKey, 'attribute_pa_size', newValue);
        dupes[i].meta_key = 'attribute_pa_size';
        dupes[i].meta_value = newValue;
      }
      continue;
    }

    // Strategy C: Compound differentiator (append size to existing value)
    if (feedSizes.some(Boolean)) {
      const compoundValues = new Set<string>();
      let allCompounded = true;
      for (let i = 0; i < dupes.length; i++) {
        const size = feedSizes[i];
        if (size) {
          const compound = `${dupes[i].meta_value}-${toSlug(size)}`;
          compoundValues.add(compound);
          if (compoundValues.size < i + 1) { allCompounded = false; break; }
        } else {
          allCompounded = false;
          break;
        }
      }
      if (allCompounded && compoundValues.size === dupes.length) {
        const sizeArr = [...feedSizes];
        for (let i = 0; i < dupes.length; i++) {
          const compound = `${dupes[i].meta_value}-${toSlug(sizeArr[i]!)}`;
          await updateVariationAttribute(db, dupes[i].id, attrKey, attrKey, compound);
          dupes[i].meta_value = compound;
        }
        continue;
      }
    }

    // Strategy D: Per-variation best effort with feed color
    for (const dupe of dupes) {
      const feed = resolveFeedProduct(feedIndex, dupe.wt_sku || '', dupe.sku || '');
      if (!feed) continue;
      if (feed.color) {
        const classified = classifyValue(feed.color);
        const newValue = toSlug(classified.normalized || feed.color);
        if (newValue !== dupe.meta_value) {
          await updateVariationAttribute(db, dupe.id, attrKey, 'attribute_pa_color', newValue);
          dupe.meta_key = 'attribute_pa_color';
          dupe.meta_value = newValue;
        }
      }
    }
  }

  // Step 3: Final single-attribute reduction (in case step 2 introduced mixed keys)
  const finalKeys = new Set(varRows.map(r => r.meta_key));
  if (finalKeys.size > 1) {
    await reduceToSingleAttribute(db, parentId, varRows, feedIndex);
  }

  // Step 4: Link all attribute terms to parent and rebuild
  await linkAllTermsToParent(db, parentId);
  await rebuildParentAttributes(db, parentId);
}

/**
 * Reduce a product to a single attribute key.
 * Picks the dominant key (most variations) and converts others using feed data.
 */
async function reduceToSingleAttribute(
  db: Connection,
  parentId: number,
  varRows: RowDataPacket[],
  feedIndex: FeedIndex
): Promise<void> {
  // Count variations per attribute key
  const keyCounts = new Map<string, number>();
  for (const row of varRows) {
    keyCounts.set(row.meta_key, (keyCounts.get(row.meta_key) || 0) + 1);
  }

  // Pick the key used by most variations; prefer pa_color over pa_size for ties
  let bestKey = '';
  let bestCount = 0;
  for (const [key, count] of keyCounts) {
    if (count > bestCount || (count === bestCount && key === 'attribute_pa_color')) {
      bestKey = key;
      bestCount = count;
    }
  }

  if (!bestKey) return;

  // Convert variations with non-best keys
  for (const row of varRows) {
    if (row.meta_key === bestKey) continue;

    // Try to get a value for the best key from feed data
    const feed = resolveFeedProduct(feedIndex, row.wt_sku || '', row.sku || '');

    if (bestKey === 'attribute_pa_color' && feed?.color) {
      const classified = classifyValue(feed.color);
      const newValue = toSlug(classified.normalized || feed.color);
      await updateVariationAttribute(db, row.id, row.meta_key, bestKey, newValue);
      row.meta_key = bestKey;
      row.meta_value = newValue;
    } else if (bestKey === 'attribute_pa_size' && feed) {
      const sizeStr = buildSizeFromFeed(feed);
      if (sizeStr) {
        const newValue = toSlug(sizeStr);
        await updateVariationAttribute(db, row.id, row.meta_key, bestKey, newValue);
        row.meta_key = bestKey;
        row.meta_value = newValue;
      }
    } else {
      // Fallback: just keep the current value under the dominant key
      await updateVariationAttribute(db, row.id, row.meta_key, bestKey, row.meta_value);
      row.meta_key = bestKey;
    }
  }

  // Delete any remaining non-best-key attributes
  const allKeys = [...keyCounts.keys()].filter(k => k !== bestKey);
  for (const removeKey of allKeys) {
    await db.query(`
      DELETE FROM wp_postmeta
      WHERE meta_key = ?
        AND post_id IN (
          SELECT v.ID FROM wp_posts v
          WHERE v.post_parent = ? AND v.post_type = 'product_variation'
        )
    `, [removeKey, parentId]);
  }
}

/**
 * Ensure all attribute term slugs used by a parent's variations
 * are linked to the parent via wp_term_relationships.
 */
async function linkAllTermsToParent(db: Connection, parentId: number): Promise<void> {
  // Get all distinct attribute values from variations
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT DISTINCT pm.meta_key, pm.meta_value
    FROM wp_postmeta pm
    JOIN wp_posts v ON v.ID = pm.post_id
    WHERE v.post_parent = ? AND v.post_type = 'product_variation'
      AND pm.meta_key LIKE 'attribute_pa_%'
      AND pm.meta_value IS NOT NULL AND pm.meta_value != ''
  `, [parentId]);

  for (const row of rows) {
    const taxonomy = row.meta_key.replace('attribute_', '');
    const slug = row.meta_value;
    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    // Ensure the term exists and get its term_taxonomy_id
    const ttId = await ensureAttributeTerm(db, taxonomy, name, slug);
    // Link to parent product
    await linkTermToProduct(db, parentId, ttId);
  }
}

/**
 * Rebuild _product_attributes for a parent from its current variation meta.
 */
async function rebuildParentAttributes(db: Connection, parentId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT DISTINCT pm.meta_key, pm.meta_value
    FROM wp_postmeta pm
    JOIN wp_posts v ON v.ID = pm.post_id
    WHERE v.post_parent = ? AND v.post_type = 'product_variation'
      AND pm.meta_key LIKE 'attribute_pa_%'
      AND pm.meta_value IS NOT NULL AND pm.meta_value != ''
  `, [parentId]);

  const attrValues = new Map<string, Set<string>>();
  for (const r of rows) {
    const taxonomy = r.meta_key.replace('attribute_', '');
    if (!attrValues.has(taxonomy)) attrValues.set(taxonomy, new Set());
    attrValues.get(taxonomy)!.add(r.meta_value);
  }

  const attrs: Record<string, any> = {};
  let position = 0;
  for (const [taxonomy, values] of attrValues) {
    attrs[taxonomy] = {
      name: taxonomy,
      value: [...values].join(' | '),
      position: position++,
      is_visible: 1,
      is_variation: 1,
      is_taxonomy: 1,
    };
  }

  await updateParentProductAttributes(db, parentId, attrs);
}

/**
 * Take a snapshot of all variations for a parent.
 */
async function snapshotVariations(db: Connection, parentId: number): Promise<SnapshotVariation[]> {
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT v.ID as id, v.post_status as status,
           MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
           MAX(CASE WHEN pm.meta_key = '_wt_sku' THEN pm.meta_value END) as warehouseSku,
           MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) as price
    FROM wp_posts v
    LEFT JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key IN ('_sku', '_wt_sku', '_regular_price')
    WHERE v.post_parent = ? AND v.post_type = 'product_variation'
    GROUP BY v.ID
  `, [parentId]);

  // Get attributes separately
  const varIds = rows.map(r => r.id);
  if (varIds.length === 0) return [];

  const [attrRows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_key, meta_value
    FROM wp_postmeta
    WHERE post_id IN (${varIds.join(',')})
      AND meta_key LIKE 'attribute_pa_%'
  `);

  const attrsByVar = new Map<number, { key: string; value: string }>();
  for (const r of attrRows) {
    if (!attrsByVar.has(r.post_id)) {
      attrsByVar.set(r.post_id, { key: r.meta_key, value: r.meta_value });
    }
  }

  return rows.map(r => ({
    id: r.id,
    sku: r.sku || '',
    warehouseSku: r.warehouseSku || '',
    price: r.price || '',
    attrKey: attrsByVar.get(r.id)?.key || '',
    attrValue: attrsByVar.get(r.id)?.value || '',
    feedName: '',
    status: r.status,
  }));
}

// ==================== Checkpoint ====================

function loadCheckpoint(plan: PipelinePlan): VariantCheckpoint | null {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  try {
    const raw = readFileSync(CHECKPOINT_FILE, 'utf-8');
    const data = JSON.parse(raw) as VariantCheckpoint;
    // Verify it matches the current plan
    if (data.planFile !== plan.timestamp) {
      console.log('  Checkpoint is from a different plan run, starting fresh');
      return null;
    }
    console.log(`  Resuming from checkpoint: ${data.completedActionIndices.length} actions completed`);
    return data;
  } catch {
    console.warn('  Failed to read checkpoint, starting fresh');
    return null;
  }
}

function saveCheckpoint(
  plan: PipelinePlan,
  completedSet: Set<number>,
  results: ExecutionResult[]
): void {
  if (!existsSync(CHECKPOINT_DIR)) mkdirSync(CHECKPOINT_DIR, { recursive: true });

  const data: VariantCheckpoint = {
    completedParentIds: [...new Set(results.filter(r => r.success).map(r => r.action.parentId))],
    completedActionIndices: [...completedSet],
    successCount: results.filter(r => r.success).length,
    errorCount: results.filter(r => !r.success).length,
    errors: results.filter(r => !r.success).map(r => ({
      parentId: r.action.parentId,
      error: r.error || 'Unknown error',
    })),
    lastBatchAt: new Date().toISOString(),
    planFile: plan.timestamp,
  };

  writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}
