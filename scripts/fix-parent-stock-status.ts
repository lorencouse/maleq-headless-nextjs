#!/usr/bin/env bun

/**
 * Fix Parent Variable Product Stock Status
 *
 * Finds variable products where the parent's _stock_status is 'instock'
 * but ALL variations are 'outofstock', and corrects the parent status.
 *
 * Also updates the wp_wc_product_meta_lookup table for consistency.
 *
 * Usage:
 *   bun scripts/fix-parent-stock-status.ts --dry-run
 *   bun scripts/fix-parent-stock-status.ts
 */

import type { Connection } from 'mysql2/promise';
import { getConnection } from './lib/db';

interface MismatchedProduct {
  id: number;
  title: string;
  totalVariations: number;
  outOfStockVariations: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
  };
}

async function findMismatchedProducts(connection: Connection): Promise<MismatchedProduct[]> {
  const [rows] = await connection.execute(`
    SELECT
      p.ID as id,
      p.post_title as title,
      COUNT(v.ID) as totalVariations,
      SUM(CASE WHEN var_stock.meta_value = 'outofstock' THEN 1 ELSE 0 END) as outOfStockVariations
    FROM wp_posts p
    INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
    INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    INNER JOIN wp_terms t ON tt.term_id = t.term_id
    INNER JOIN wp_postmeta parent_stock ON p.ID = parent_stock.post_id AND parent_stock.meta_key = '_stock_status'
    INNER JOIN wp_posts v ON v.post_parent = p.ID AND v.post_type = 'product_variation' AND v.post_status = 'publish'
    LEFT JOIN wp_postmeta var_stock ON v.ID = var_stock.post_id AND var_stock.meta_key = '_stock_status'
    WHERE p.post_type = 'product'
      AND p.post_status = 'publish'
      AND tt.taxonomy = 'product_type'
      AND t.slug = 'variable'
      AND parent_stock.meta_value = 'instock'
    GROUP BY p.ID, p.post_title
    HAVING totalVariations > 0 AND totalVariations = outOfStockVariations
    ORDER BY p.ID
  `);

  return (rows as any[]).map(r => ({
    id: r.id,
    title: r.title,
    totalVariations: r.totalVariations,
    outOfStockVariations: r.outOfStockVariations,
  }));
}

async function main() {
  const { dryRun } = parseArgs();

  console.log('='.repeat(60));
  console.log('Fix Parent Variable Product Stock Status');
  console.log('='.repeat(60));
  if (dryRun) console.log('DRY RUN - No changes will be made\n');

  const connection = await getConnection();

  const products = await findMismatchedProducts(connection);
  console.log(`Found ${products.length} variable products with mismatched stock status\n`);

  if (products.length === 0) {
    console.log('Nothing to fix!');
    await connection.end();
    return;
  }

  // Show sample
  console.log('Sample:');
  for (const p of products.slice(0, 5)) {
    console.log(`  ID ${p.id}: ${p.title} (${p.totalVariations} variations, all OOS)`);
  }
  if (products.length > 5) console.log(`  ... and ${products.length - 5} more\n`);

  if (!dryRun) {
    const ids = products.map(p => p.id);

    // Batch update _stock_status in wp_postmeta
    const placeholders = ids.map(() => '?').join(',');
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = 'outofstock'
       WHERE meta_key = '_stock_status' AND post_id IN (${placeholders})`,
      ids
    );
    console.log(`Updated _stock_status for ${ids.length} parent products`);

    // Batch update wp_wc_product_meta_lookup
    await connection.execute(
      `UPDATE wp_wc_product_meta_lookup SET stock_status = 'outofstock'
       WHERE product_id IN (${placeholders})`,
      ids
    );
    console.log(`Updated wp_wc_product_meta_lookup for ${ids.length} products`);

    // Verify
    const remaining = await findMismatchedProducts(connection);
    console.log(`\nVerification: ${remaining.length} mismatched products remaining`);
  }

  console.log('\nDone.');
  await connection.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
