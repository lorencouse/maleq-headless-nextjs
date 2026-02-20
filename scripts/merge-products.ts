/**
 * Manual Product Merge Script
 *
 * Merges multiple products (variable or simple) into a single variable parent.
 * Use when the automated pipeline can't merge products with differing SKU prefixes.
 *
 * Usage:
 *   bun scripts/merge-products.ts <master-id> <merge-id-1> [merge-id-2] ... [options]
 *
 * Options:
 *   --local          Connect to local DB (default behavior from db.ts)
 *   --dry-run        Preview changes without applying
 *   --delete-merged  Delete merged parents instead of drafting them (default: draft)
 *
 * Example:
 *   bun scripts/merge-products.ts 195450 594324 594326 204753 --local
 *   bun scripts/merge-products.ts 195450 594324 594326 204753 --local --dry-run
 */

import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { moveVariationsToParent, setParentDraft, updateMetaLookup } from './lib/variant-manager/db-mutations';
import { rebuildParentAttributes, linkAllTermsToParent, cleanupGalleryAfterSplit } from './lib/variant-manager/executor';
import { createInterface } from 'readline';

// ── Types ──

interface ProductInfo {
  id: number;
  title: string;
  type: string; // 'simple' | 'variable'
  status: string;
  variationCount: number;
  variationIds: number[];
}

// ── CLI Parsing ──

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const dryRun = flags.has('--dry-run');
const deleteMerged = flags.has('--delete-merged');

if (args.length < 2) {
  console.error('Usage: bun scripts/merge-products.ts <master-id> <merge-id-1> [merge-id-2] ... [options]');
  console.error('Options: --local  --dry-run  --delete-merged');
  process.exit(1);
}

const masterId = parseInt(args[0], 10);
const mergeIds = args.slice(1).map(id => parseInt(id, 10));

if ([masterId, ...mergeIds].some(isNaN)) {
  console.error('Error: All IDs must be valid numbers.');
  process.exit(1);
}

if (mergeIds.includes(masterId)) {
  console.error('Error: Master ID cannot also appear in merge IDs.');
  process.exit(1);
}

// ── Helpers ──

async function loadProduct(db: Connection, id: number): Promise<ProductInfo | null> {
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT p.ID as id, p.post_title as title, p.post_status as status,
           COALESCE(
             (SELECT t.slug FROM wp_term_relationships tr
              JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
              JOIN wp_terms t ON t.term_id = tt.term_id
              WHERE tr.object_id = p.ID LIMIT 1),
             'simple'
           ) as product_type
    FROM wp_posts p
    WHERE p.ID = ? AND p.post_type = 'product'
    LIMIT 1
  `, [id]);

  if (rows.length === 0) return null;

  const row = rows[0];

  // Get variation IDs if variable
  let variationIds: number[] = [];
  if (row.product_type === 'variable') {
    const [varRows] = await db.query<RowDataPacket[]>(`
      SELECT ID FROM wp_posts
      WHERE post_parent = ? AND post_type = 'product_variation'
      ORDER BY ID
    `, [id]);
    variationIds = varRows.map(v => v.ID);
  }

  return {
    id: row.id,
    title: row.title,
    type: row.product_type,
    status: row.status,
    variationCount: variationIds.length,
    variationIds,
  };
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

async function convertSimpleToVariation(db: Connection, productId: number, masterId: number): Promise<void> {
  // Change post_type and set parent
  await db.query(`
    UPDATE wp_posts SET post_type = 'product_variation', post_parent = ?
    WHERE ID = ? AND post_type = 'product'
  `, [masterId, productId]);

  // Remove product_type taxonomy relationship (simple products have product_type=simple)
  await db.query(`
    DELETE tr FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
    WHERE tr.object_id = ? AND tt.taxonomy = 'product_type'
  `, [productId]);

  // Check if it has a size attribute; if not, try to extract from title
  const [attrRows] = await db.query<RowDataPacket[]>(`
    SELECT meta_value FROM wp_postmeta
    WHERE post_id = ? AND meta_key = 'attribute_pa_size'
  `, [productId]);

  if (attrRows.length === 0) {
    // Try to extract size from title
    const [titleRow] = await db.query<RowDataPacket[]>(`
      SELECT post_title FROM wp_posts WHERE ID = ?
    `, [productId]);
    const title = titleRow[0]?.post_title || '';
    const sizeMatch = title.match(/(\d+(?:\.\d+)?\s*(?:oz|ml|fl\.?\s*oz|inch|inches|in|"|pc|pcs|pack|ct|count|gal|gallon|liter|litre|lb|lbs|g|gram|mg|cc|mm|cm))\b/i);
    if (sizeMatch) {
      const sizeSlug = sizeMatch[1].toLowerCase().replace(/\s+/g, '-').replace(/\./g, '-');
      await db.query(`
        INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, 'attribute_pa_size', ?)
      `, [productId, sizeSlug]);
    }
  }
}

async function deleteProduct(db: Connection, productId: number): Promise<void> {
  // Delete meta
  await db.query(`DELETE FROM wp_postmeta WHERE post_id = ?`, [productId]);
  // Delete term relationships
  await db.query(`DELETE FROM wp_term_relationships WHERE object_id = ?`, [productId]);
  // Delete from meta lookup
  await db.query(`DELETE FROM wp_wc_product_meta_lookup WHERE product_id = ?`, [productId]);
  // Delete post
  await db.query(`DELETE FROM wp_posts WHERE ID = ?`, [productId]);
}

// ── Main ──

async function main() {
  const db = await getConnection();

  try {
    // Step 1: Validate all IDs
    console.log('Loading products...\n');

    const master = await loadProduct(db, masterId);
    if (!master) {
      console.error(`Error: Master product #${masterId} not found.`);
      process.exit(1);
    }

    const mergeProducts: ProductInfo[] = [];
    for (const id of mergeIds) {
      const product = await loadProduct(db, id);
      if (!product) {
        console.error(`Error: Merge product #${id} not found.`);
        process.exit(1);
      }
      mergeProducts.push(product);
    }

    // Step 2: Preview
    const disposition = deleteMerged ? 'delete' : 'draft';
    console.log(`Master: ${master.title} (ID: ${master.id}, ${master.type}, ${master.variationCount} variations)`);
    for (const p of mergeProducts) {
      const action = p.type === 'simple'
        ? `convert to variation, then ${disposition}`
        : `move ${p.variationCount} variations, then ${disposition}`;
      console.log(`Merge:  ${p.title} (ID: ${p.id}, ${p.type}, ${p.variationCount} variations) → ${action}`);
    }
    console.log(`\nMode: ${dryRun ? 'DRY RUN (no changes)' : 'APPLY'}`);
    console.log(`Merged parents will be: ${deleteMerged ? 'DELETED' : 'set to DRAFT'}\n`);

    if (dryRun) {
      console.log('Dry run complete. No changes made.');
      return;
    }

    const ok = await confirm('Proceed? (Y/n) ');
    if (!ok) {
      console.log('Aborted.');
      return;
    }

    // Step 3: Execute in a single transaction
    console.log('\nExecuting merge...');
    await db.beginTransaction();

    let totalVariationsMoved = 0;

    try {
      for (const p of mergeProducts) {
        if (p.type === 'variable' && p.variationIds.length > 0) {
          // Move all variations to master
          await moveVariationsToParent(db, p.variationIds, masterId);
          totalVariationsMoved += p.variationIds.length;
          console.log(`  Moved ${p.variationIds.length} variations from #${p.id} → #${masterId}`);
        } else if (p.type === 'simple') {
          // Convert simple product to variation under master
          await convertSimpleToVariation(db, p.id, masterId);
          totalVariationsMoved += 1;
          console.log(`  Converted simple product #${p.id} to variation under #${masterId}`);
          continue; // Don't draft/delete — it IS the variation now
        }

        // Draft or delete the merged parent
        if (deleteMerged) {
          await deleteProduct(db, p.id);
          console.log(`  Deleted merged parent #${p.id}`);
        } else {
          await setParentDraft(db, p.id);
          // Remove from meta lookup so it doesn't appear in listings
          await db.query(`DELETE FROM wp_wc_product_meta_lookup WHERE product_id = ?`, [p.id]);
          console.log(`  Set merged parent #${p.id} to draft`);
        }
      }

      // Ensure master has product_type=variable taxonomy
      const [typeCheck] = await db.query<RowDataPacket[]>(`
        SELECT 1 FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
        JOIN wp_terms t ON t.term_id = tt.term_id
        WHERE tr.object_id = ? AND tt.taxonomy = 'product_type' AND t.slug = 'variable'
        LIMIT 1
      `, [masterId]);

      if (typeCheck.length === 0) {
        // Get variable term_taxonomy_id
        const [varTerm] = await db.query<RowDataPacket[]>(`
          SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
          JOIN wp_terms t ON t.term_id = tt.term_id
          WHERE tt.taxonomy = 'product_type' AND t.slug = 'variable'
          LIMIT 1
        `);
        if (varTerm.length > 0) {
          // Remove existing product_type relationship
          await db.query(`
            DELETE tr FROM wp_term_relationships tr
            JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
            WHERE tr.object_id = ? AND tt.taxonomy = 'product_type'
          `, [masterId]);
          // Add variable type
          await db.query(`
            INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
            VALUES (?, ?, 0)
          `, [masterId, varTerm[0].term_taxonomy_id]);
        }
      }

      // Post-merge cleanup
      console.log('\n  Rebuilding attributes...');
      await rebuildParentAttributes(db, masterId);
      await linkAllTermsToParent(db, masterId);
      await updateMetaLookup(db, masterId);
      await cleanupGalleryAfterSplit(db, masterId);

      await db.commit();
      console.log('\n  Transaction committed.');
    } catch (err) {
      await db.rollback();
      console.error('\n  Transaction rolled back due to error:', err);
      process.exit(1);
    }

    // Step 4: Report
    const [finalVars] = await db.query<RowDataPacket[]>(`
      SELECT COUNT(*) as cnt FROM wp_posts
      WHERE post_parent = ? AND post_type = 'product_variation'
    `, [masterId]);

    console.log('\n=== Merge Complete ===');
    console.log(`Master product: #${masterId} "${master.title}"`);
    console.log(`Variations moved/converted: ${totalVariationsMoved}`);
    console.log(`Total variations on master: ${finalVars[0].cnt}`);
    console.log(`Merged parents ${deleteMerged ? 'deleted' : 'drafted'}: ${mergeProducts.filter(p => p.type !== 'simple').length}`);
    console.log(`Simple products converted: ${mergeProducts.filter(p => p.type === 'simple').length}`);

  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
