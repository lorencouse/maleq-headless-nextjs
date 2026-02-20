/**
 * Planner — Phase 3: Generate a prioritized action plan from audit results.
 *
 * Takes audit results and produces a list of planned actions sorted by priority.
 * Each action has a confidence score to allow filtering.
 */

import type {
  AuditResult, PlannedAction, PipelinePlan, ActionType, FeedIndex,
  SplitGroupPlan, AttrChange, VariationRecord,
} from './types';
import { extractSkuPrefix } from './sku-patterns';
import {
  classifyValue, classifyAttrValues, extractDifferentiator,
  stripParentNameFromValue, buildSizeFromFeed,
} from './classification';
import {
  chooseVariationAttribute, attrTypeToTaxonomy, taxonomyToAttrType,
  getAllowedAttributes,
} from './category-rules';
import { toSlug, ensureUniqueSlug, labelFromFeedNames } from './utils';

// Action type → execution priority (lower = runs first)
const PRIORITY_MAP: Record<ActionType, number> = {
  'convert-to-draft': 1,
  'delete-discontinued': 2,
  'split-product-lines': 3,
  'fix-duplicate-attrs': 4,
  'reduce-to-single-attr': 5,
  'reclassify-attribute': 6,
  'convert-simple-to-variable': 7,
};

/**
 * Generate a full pipeline plan from audit results.
 */
export function generatePlan(audits: AuditResult[], feedIndex: FeedIndex): PipelinePlan {
  console.log('\n--- Phase 3: Generating action plan ---');

  const actions: PlannedAction[] = [];
  const skipped: Array<{ parentId: number; parentTitle: string; reason: string }> = [];
  const usedSlugs = new Set<string>();

  for (const audit of audits) {
    if (audit.issues.includes('ok')) continue;

    // Generate actions for each issue
    for (const issue of audit.issues) {
      const action = planActionForIssue(audit, issue, feedIndex, usedSlugs);
      if (action) {
        actions.push(action);
      } else if (issue !== 'ok') {
        skipped.push({
          parentId: audit.parentId,
          parentTitle: audit.parentTitle,
          reason: `Could not plan action for issue: ${issue}`,
        });
      }
    }
  }

  // Sort by priority
  actions.sort((a, b) => a.priority - b.priority || a.parentId - b.parentId);

  // Build summary
  const actionsByType: Record<string, number> = {};
  let totalVariationsAffected = 0;
  let totalNewParentsToCreate = 0;

  for (const action of actions) {
    actionsByType[action.type] = (actionsByType[action.type] || 0) + 1;
    if (action.deleteVarIds) totalVariationsAffected += action.deleteVarIds.length;
    if (action.splitGroups) {
      totalNewParentsToCreate += action.splitGroups.filter(g => !g.isKeepGroup).length;
      totalVariationsAffected += action.splitGroups.reduce((sum, g) => sum + g.variationIds.length, 0);
    }
    if (action.attrChanges) totalVariationsAffected += action.attrChanges.length;
  }

  console.log(`  Planned ${actions.length} actions (${skipped.length} skipped)`);
  for (const [type, count] of Object.entries(actionsByType)) {
    console.log(`    ${type}: ${count}`);
  }

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalParentsScanned: audits.length,
      totalActionsPlanned: actions.length,
      actionsByType,
      totalVariationsAffected,
      totalNewParentsToCreate,
    },
    actions,
    skipped,
  };
}

function planActionForIssue(
  audit: AuditResult,
  issue: string,
  feedIndex: FeedIndex,
  usedSlugs: Set<string>
): PlannedAction | null {
  switch (issue) {
    case 'all-discontinued':
      return planConvertToDraft(audit);
    case 'has-discontinued':
      return planDeleteDiscontinued(audit);
    case 'needs-split':
      return planSplit(audit, feedIndex, usedSlugs);
    case 'multi-attribute':
      return planReduceToSingleAttr(audit);
    case 'wrong-attribute':
      return planReclassify(audit);
    case 'duplicate-attrs':
      return planFixDuplicates(audit, feedIndex);
    case 'parent-name-in-attrs':
      return planStripParentName(audit);
    default:
      return null;
  }
}

// ==================== Action Planners ====================

function planConvertToDraft(audit: AuditResult): PlannedAction {
  return {
    type: 'convert-to-draft',
    priority: PRIORITY_MAP['convert-to-draft'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence: 0.95,
    confidenceFlags: [],
  };
}

function planDeleteDiscontinued(audit: AuditResult): PlannedAction {
  const flags: string[] = [];
  const ratio = audit.discontinuedVarIds.length / audit.variations.length;

  let confidence = 0.9;
  if (ratio > 0.7) {
    flags.push(`${Math.round(ratio * 100)}% discontinued — consider drafting entire product`);
    confidence = 0.7;
  }

  return {
    type: 'delete-discontinued',
    priority: PRIORITY_MAP['delete-discontinued'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence,
    confidenceFlags: flags,
    deleteVarIds: audit.discontinuedVarIds,
  };
}

function planSplit(
  audit: AuditResult,
  feedIndex: FeedIndex,
  usedSlugs: Set<string>
): PlannedAction | null {
  if (!audit.skuGroups || audit.skuGroups.size <= 1) return null;

  const groups = audit.skuGroups;
  const flags: string[] = [];
  let confidence = 0.85;

  // Build split group plans
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  const splitGroups: SplitGroupPlan[] = [];

  for (let i = 0; i < sortedGroups.length; i++) {
    const [prefix, members] = sortedGroups[i];
    const isKeep = i === 0; // Largest group stays on original parent

    // Build label from feed names
    const feedNames = members
      .map(v => v.feedProduct?.name || '')
      .filter(n => n);
    const label = feedNames.length > 0 ? labelFromFeedNames(feedNames) : prefix;

    // Build new title/slug for non-keep groups
    let newTitle = audit.parentTitle;
    let newSlug = audit.parentSlug;

    if (!isKeep) {
      newTitle = label || `${audit.parentTitle} - ${prefix}`;
      newSlug = ensureUniqueSlug(toSlug(newTitle), usedSlugs);
    }

    splitGroups.push({
      label,
      variationIds: members.map(v => v.id),
      skuPrefix: prefix,
      newParentTitle: newTitle,
      newParentSlug: newSlug,
      isKeepGroup: isKeep,
    });
  }

  // Confidence adjustments
  if (sortedGroups.length > 4) {
    confidence -= 0.15;
    flags.push(`many groups (${sortedGroups.length})`);
  }

  // Check for singletons
  const singletonCount = sortedGroups.filter(([, m]) => m.length === 1).length;
  if (singletonCount > 0) {
    confidence -= 0.1;
    flags.push(`${singletonCount} singleton groups`);
  }

  // Note: mixed prices within groups are normal for size variants (2oz, 4oz, etc.)
  // and should not lower confidence. The auditor's same-price anti-split check
  // already handles the important case (all variations identical price = don't split).

  // Check for duplicate feed names across groups
  const allFeedNames = new Set<string>();
  let dupeNames = 0;
  for (const [, members] of sortedGroups) {
    for (const v of members) {
      const name = v.feedProduct?.name || '';
      if (name && allFeedNames.has(name)) dupeNames++;
      if (name) allFeedNames.add(name);
    }
  }
  if (dupeNames > 0) {
    confidence -= 0.2;
    flags.push(`${dupeNames} duplicate feed names across groups`);
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    type: 'split-product-lines',
    priority: PRIORITY_MAP['split-product-lines'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence,
    confidenceFlags: flags,
    splitGroups,
  };
}

function planReduceToSingleAttr(audit: AuditResult): PlannedAction | null {
  if (audit.attrKeys.length <= 1) return null;

  const { taxonomy, attrType, reason } = chooseVariationAttribute(
    audit.variations, audit.isLubricant
  );

  const keepKey = `attribute_${taxonomy}`;
  const removeKeys = audit.attrKeys.filter(k => k !== keepKey);

  if (removeKeys.length === 0) return null;

  const flags: string[] = [reason];
  let confidence = 0.7;

  // If we're keeping an attribute that already exists, higher confidence
  if (audit.attrKeys.includes(keepKey)) {
    confidence = 0.8;
  }

  return {
    type: 'reduce-to-single-attr',
    priority: PRIORITY_MAP['reduce-to-single-attr'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence,
    confidenceFlags: flags,
    keepDimension: taxonomy,
    removeDimension: removeKeys.map(k => k.replace('attribute_', '')).join(', '),
  };
}

function planReclassify(audit: AuditResult): PlannedAction | null {
  if (audit.attrKeys.length !== 1) return null;

  const currentKey = audit.attrKeys[0];
  const currentTaxonomy = currentKey.replace('attribute_', '');
  const currentType = taxonomyToAttrType(currentTaxonomy);

  const { taxonomy: targetTaxonomy, attrType: targetType, reason } = chooseVariationAttribute(
    audit.variations, audit.isLubricant
  );

  if (currentTaxonomy === targetTaxonomy) return null;

  // Build attr changes
  const attrChanges: AttrChange[] = [];
  const newTermsNeeded = new Set<string>();

  for (const v of audit.variations) {
    const oldValue = v.attrs.get(currentKey) || '';
    if (!oldValue) continue;

    const classified = classifyValue(oldValue);
    const newValue = classified.normalized || oldValue;
    const newSlug = toSlug(newValue);

    attrChanges.push({
      variationId: v.id,
      oldKey: currentKey,
      oldValue,
      newKey: `attribute_${targetTaxonomy}`,
      newValue,
      newSlug,
    });

    newTermsNeeded.add(newSlug);
  }

  return {
    type: 'reclassify-attribute',
    priority: PRIORITY_MAP['reclassify-attribute'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence: 0.75,
    confidenceFlags: [reason],
    attrChanges,
    reclassifyFrom: currentTaxonomy,
    reclassifyTo: targetTaxonomy,
    newTermsNeeded: [...newTermsNeeded],
  };
}

function planStripParentName(audit: AuditResult): PlannedAction | null {
  const attrChanges: AttrChange[] = [];
  const newTermsNeeded: string[] = [];

  for (const v of audit.variations) {
    for (const [key, value] of v.attrs.entries()) {
      if (!key.startsWith('attribute_pa_') || !value) continue;
      const stripped = stripParentNameFromValue(value, audit.parentTitle);
      if (stripped && stripped !== value) {
        const newSlug = toSlug(stripped);
        attrChanges.push({
          variationId: v.id,
          oldKey: key,
          oldValue: value,
          newKey: key,
          newValue: stripped,
          newSlug,
        });
        newTermsNeeded.push(newSlug);
      }
    }
  }

  if (attrChanges.length === 0) return null;

  return {
    type: 'fix-duplicate-attrs',
    priority: PRIORITY_MAP['fix-duplicate-attrs'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence: 0.9,
    confidenceFlags: [],
    attrChanges,
    newTermsNeeded: [...new Set(newTermsNeeded)],
  };
}

function planFixDuplicates(
  audit: AuditResult,
  feedIndex: FeedIndex
): PlannedAction | null {
  // Find variations that share identical attribute fingerprints
  const fingerprints = new Map<string, VariationRecord[]>();
  for (const v of audit.variations) {
    const parts: string[] = [];
    for (const [key, value] of [...v.attrs.entries()].sort()) {
      if (key.startsWith('attribute_pa_')) {
        parts.push(`${key}=${value}`);
      }
    }
    const fp = parts.join('|');
    if (!fp) continue;
    if (!fingerprints.has(fp)) fingerprints.set(fp, []);
    fingerprints.get(fp)!.push(v);
  }

  const attrChanges: AttrChange[] = [];
  const newTermsNeeded = new Set<string>();
  const flags: string[] = [];
  let fixableCount = 0;
  let unfixableCount = 0;
  const attrKey = audit.attrKeys[0] || 'attribute_pa_variant';

  // First pass: strip parent name from attribute values (Case 3 from VARIANT-RULES.md §7)
  const parentNameStrips = new Map<number, string>();
  for (const v of audit.variations) {
    const oldValue = v.attrs.get(attrKey) || '';
    if (!oldValue) continue;
    const stripped = stripParentNameFromValue(oldValue, audit.parentTitle);
    if (stripped && stripped !== oldValue) {
      parentNameStrips.set(v.id, stripped);
    }
  }

  if (parentNameStrips.size > 0) {
    flags.push(`${parentNameStrips.size} values have parent name stripped`);
  }

  for (const [, dupeSet] of fingerprints) {
    if (dupeSet.length <= 1) continue;

    // Determine the best differentiator strategy for this duplicate set
    const resolved = resolveDuplicateSet(dupeSet, attrKey, audit.parentTitle, parentNameStrips);

    for (const change of resolved.changes) {
      attrChanges.push(change);
      newTermsNeeded.add(change.newSlug);
      fixableCount++;
    }
    unfixableCount += resolved.unfixableCount;
  }

  // Also apply parent name stripping to non-duplicate variations (clean up all values)
  for (const v of audit.variations) {
    const oldValue = v.attrs.get(attrKey) || '';
    if (!oldValue) continue;

    // Skip if we already planned a change for this variation
    if (attrChanges.some(c => c.variationId === v.id)) continue;

    const stripped = parentNameStrips.get(v.id);
    if (stripped) {
      const newSlug = toSlug(stripped);
      attrChanges.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue,
        newKey: attrKey,
        newValue: stripped,
        newSlug,
      });
      newTermsNeeded.add(newSlug);
      fixableCount++;
    }
  }

  if (attrChanges.length === 0) return null;

  let confidence = 0.7;
  if (unfixableCount > 0) {
    confidence -= 0.2;
    flags.push(`${unfixableCount} unfixable duplicates`);
  }
  // Higher confidence when all duplicates are resolved
  if (unfixableCount === 0 && fixableCount > 0) {
    confidence = 0.8;
  }

  return {
    type: 'fix-duplicate-attrs',
    priority: PRIORITY_MAP['fix-duplicate-attrs'],
    parentId: audit.parentId,
    parentTitle: audit.parentTitle,
    parentSlug: audit.parentSlug,
    confidence: Math.max(0, confidence),
    confidenceFlags: flags,
    attrChanges,
    newTermsNeeded: [...newTermsNeeded],
  };
}

/**
 * Resolve a set of duplicate variations by finding differentiating values.
 *
 * Strategy priority:
 * 1. Parent name stripping (if stripping produces unique values)
 * 2. Feed color field (if colors differ within the dupe set)
 * 3. Feed size/dimensions (if sizes differ)
 * 4. Feed name differentiator (unique words in feed names)
 * 5. Append size to color (e.g., "orange" → "orange-6in") for compound differentiator
 */
function resolveDuplicateSet(
  dupeSet: VariationRecord[],
  attrKey: string,
  parentTitle: string,
  parentNameStrips: Map<number, string>,
): { changes: AttrChange[]; unfixableCount: number } {
  const changes: AttrChange[] = [];
  let unfixableCount = 0;

  // Strategy 1: Check if parent name stripping alone produces unique values
  const strippedValues = dupeSet.map(v => parentNameStrips.get(v.id) || null);
  const uniqueStripped = new Set(strippedValues.filter(Boolean));
  if (uniqueStripped.size === dupeSet.length && strippedValues.every(Boolean)) {
    for (let i = 0; i < dupeSet.length; i++) {
      const v = dupeSet[i];
      const newValue = strippedValues[i]!;
      const newSlug = toSlug(newValue);
      changes.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue: v.attrs.get(attrKey) || '',
        newKey: attrKey,
        newValue,
        newSlug,
      });
    }
    return { changes, unfixableCount: 0 };
  }

  // Strategy 2: Feed color field (if distinct across the dupe set)
  // Switch attribute key to pa_color when resolving via feed colors
  const feedColors = dupeSet.map(v => v.feedProduct?.color || '');
  const uniqueColors = new Set(feedColors.filter(c => c));
  if (uniqueColors.size === dupeSet.length && feedColors.every(c => c)) {
    const newKey = 'attribute_pa_color';
    for (let i = 0; i < dupeSet.length; i++) {
      const v = dupeSet[i];
      const classified = classifyValue(feedColors[i]);
      const newValue = classified.normalized || feedColors[i];
      const newSlug = toSlug(newValue);
      changes.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue: v.attrs.get(attrKey) || '',
        newKey,
        newValue,
        newSlug,
      });
    }
    return { changes, unfixableCount: 0 };
  }

  // Strategy 3: Feed size/dimensions (distinct sizes across dupe set)
  // Switch attribute key to pa_size when resolving via feed sizes
  const feedSizes = dupeSet.map(v =>
    v.feedProduct ? buildSizeFromFeed(v.feedProduct) : null
  );
  const uniqueSizes = new Set(feedSizes.filter(Boolean));
  if (uniqueSizes.size === dupeSet.length && feedSizes.every(Boolean)) {
    for (let i = 0; i < dupeSet.length; i++) {
      const v = dupeSet[i];
      const newValue = feedSizes[i]!;
      const newSlug = toSlug(newValue);
      changes.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue: v.attrs.get(attrKey) || '',
        newKey: 'attribute_pa_size',
        newValue,
        newSlug,
      });
    }
    return { changes, unfixableCount: 0 };
  }

  // Strategy 4: Feed name differentiator
  const feedNames = dupeSet.map(v => v.feedProduct?.name || '');
  const allHaveNames = feedNames.every(n => n);
  if (allHaveNames) {
    let allDiffed = true;
    for (let i = 0; i < dupeSet.length; i++) {
      const v = dupeSet[i];
      const otherNames = feedNames.filter((_, idx) => idx !== i);
      const diff = extractDifferentiator(feedNames[i], otherNames);
      if (diff) {
        const newValue = diff.classified.normalized || diff.text;
        const newSlug = toSlug(newValue);
        changes.push({
          variationId: v.id,
          oldKey: attrKey,
          oldValue: v.attrs.get(attrKey) || '',
          newKey: attrKey,
          newValue,
          newSlug,
        });
      } else {
        allDiffed = false;
      }
    }
    if (allDiffed) return { changes, unfixableCount: 0 };
    // Reset if not all resolved
    changes.length = 0;
  }

  // Strategy 5: Append size to existing color (compound differentiator)
  // e.g., "orange" + size "6in" → "orange-6in"
  if (feedSizes.some(Boolean)) {
    let allCompounded = true;
    const compoundValues = new Set<string>();
    for (let i = 0; i < dupeSet.length; i++) {
      const v = dupeSet[i];
      const oldValue = v.attrs.get(attrKey) || '';
      const size = feedSizes[i];
      if (size) {
        const compoundValue = `${oldValue}-${toSlug(size)}`;
        if (compoundValues.has(compoundValue)) {
          allCompounded = false;
          break;
        }
        compoundValues.add(compoundValue);
        changes.push({
          variationId: v.id,
          oldKey: attrKey,
          oldValue,
          newKey: attrKey,
          newValue: compoundValue,
          newSlug: toSlug(compoundValue),
        });
      } else {
        allCompounded = false;
      }
    }
    if (allCompounded && compoundValues.size === dupeSet.length) {
      return { changes, unfixableCount: 0 };
    }
    changes.length = 0;
  }

  // Fallback: try per-variation best-effort (original logic)
  for (let i = 0; i < dupeSet.length; i++) {
    const v = dupeSet[i];
    if (!v.feedProduct) {
      unfixableCount++;
      continue;
    }

    // Try color
    const feedColor = v.feedProduct.color;
    if (feedColor) {
      const classified = classifyValue(feedColor);
      const newValue = classified.normalized || feedColor;
      const newSlug = toSlug(newValue);
      changes.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue: v.attrs.get(attrKey) || '',
        newKey: attrKey,
        newValue,
        newSlug,
      });
      continue;
    }

    // Try name differentiator
    const otherNames = feedNames.filter((_, idx) => idx !== i);
    const diff = extractDifferentiator(feedNames[i], otherNames);
    if (diff) {
      const newValue = diff.classified.normalized || diff.text;
      const newSlug = toSlug(newValue);
      changes.push({
        variationId: v.id,
        oldKey: attrKey,
        oldValue: v.attrs.get(attrKey) || '',
        newKey: attrKey,
        newValue,
        newSlug,
      });
    } else {
      unfixableCount++;
    }
  }

  return { changes, unfixableCount };
}
