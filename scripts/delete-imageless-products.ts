#!/usr/bin/env bun

/**
 * Delete Products Without Images
 *
 * Finds and removes products that have no featured image (_thumbnail_id is NULL, empty, or 0).
 * Supports filtering by product source (STC, Williams Trading, etc.).
 *
 * Usage:
 *   bun scripts/delete-imageless-products.ts --analyze
 *   bun scripts/delete-imageless-products.ts --dry-run
 *   bun scripts/delete-imageless-products.ts --apply
 *
 * Options:
 *   --analyze         Show analysis of imageless products (default)
 *   --dry-run         Show what would be deleted without making changes
 *   --apply           Actually delete products
 *   --source <name>   Filter by source: stc, wt, all (default: all)
 *   --limit <n>       Limit number of products to process
 *   --include-variable  Also delete variable parent products (default: simple only)
 */

import type { Connection } from 'mysql2/promise';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConnection } from './lib/db';
const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';

type Mode = 'analyze' | 'dry-run' | 'apply';

interface Options {
  mode: Mode;
  source: 'stc' | 'wt' | 'all';
  limit?: number;
  includeVariable: boolean;
}

interface ImagelessProduct {
  id: number;
  title: string;
  type: string;
  sku: string;
  source: string;
  variationCount: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    mode: 'analyze',
    source: 'all',
    includeVariable: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--analyze') options.mode = 'analyze';
    else if (arg === '--dry-run') options.mode = 'dry-run';
    else if (arg === '--apply') options.mode = 'apply';
    else if (arg === '--source' && i + 1 < args.length) {
      options.source = args[i + 1] as Options['source'];
      i++;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--include-variable') {
      options.includeVariable = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Delete Products Without Images

Usage:
  bun scripts/delete-imageless-products.ts [mode] [options]

Modes:
  --analyze           Show analysis of imageless products (default)
  --dry-run           Show what would be deleted
  --apply             Actually delete products and their data

Options:
  --source <name>     Filter by source: stc, wt, all (default: all)
  --limit <n>         Limit number of products to process
  --include-variable  Include variable parent products (default: simple only)
  --help, -h          Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

async function findImagelessProducts(connection: Connection, options: Options): Promise<ImagelessProduct[]> {
  let query = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_type as type,
      COALESCE(sku.meta_value, '') as sku,
      COALESCE(source.meta_value, 'unknown') as source,
      (SELECT COUNT(*) FROM wp_posts v WHERE v.post_parent = p.ID AND v.post_type = 'product_variation') as variationCount
    FROM wp_posts p
    LEFT JOIN wp_postmeta thumb ON p.ID = thumb.post_id AND thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta sku ON p.ID = sku.post_id AND sku.meta_key = '_sku'
    LEFT JOIN wp_postmeta source ON p.ID = source.post_id AND source.meta_key = '_product_source'
    WHERE p.post_type = 'product'
      AND p.post_status = 'publish'
      AND (thumb.meta_value IS NULL OR thumb.meta_value = '' OR thumb.meta_value = '0')
  `;

  // Filter by product type
  if (!options.includeVariable) {
    query += `
      AND NOT EXISTS (
        SELECT 1 FROM wp_postmeta pt
        WHERE pt.post_id = p.ID AND pt.meta_key = '_product_type' AND pt.meta_value = 'variable'
      )
    `;
  }

  // Filter by source
  if (options.source === 'stc') {
    query += ` AND (source.meta_value LIKE '%stc%' OR EXISTS (SELECT 1 FROM wp_postmeta s WHERE s.post_id = p.ID AND s.meta_key = '_stc_upc'))`;
  } else if (options.source === 'wt') {
    query += ` AND EXISTS (SELECT 1 FROM wp_postmeta wt WHERE wt.post_id = p.ID AND wt.meta_key = '_wt_product_id')`;
  }

  query += ` ORDER BY p.ID ASC`;

  if (options.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  const [rows] = await connection.execute(query);
  return (rows as any[]).map(row => ({
    id: row.id,
    title: row.title,
    type: row.type,
    sku: row.sku,
    source: row.source,
    variationCount: row.variationCount,
  }));
}

async function deleteProduct(connection: Connection, product: ImagelessProduct): Promise<void> {
  // Delete variations first
  if (product.variationCount > 0) {
    // Get variation IDs
    const [variations] = await connection.execute(
      `SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation'`,
      [product.id]
    );

    for (const variation of variations as any[]) {
      // Delete variation meta
      await connection.execute(`DELETE FROM wp_postmeta WHERE post_id = ?`, [variation.ID]);
      // Delete variation term relationships
      await connection.execute(`DELETE FROM wp_term_relationships WHERE object_id = ?`, [variation.ID]);
      // Delete variation post
      await connection.execute(`DELETE FROM wp_posts WHERE ID = ?`, [variation.ID]);
    }
  }

  // Delete product meta
  await connection.execute(`DELETE FROM wp_postmeta WHERE post_id = ?`, [product.id]);
  // Delete term relationships (categories, tags, etc.)
  await connection.execute(`DELETE FROM wp_term_relationships WHERE object_id = ?`, [product.id]);
  // Delete comments/reviews
  await connection.execute(`DELETE FROM wp_comments WHERE comment_post_ID = ?`, [product.id]);
  // Delete the product post
  await connection.execute(`DELETE FROM wp_posts WHERE ID = ?`, [product.id]);
}

async function main() {
  const options = parseArgs();

  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║  Delete Products Without Images        ║');
  console.log('╚═══════════════════════════════════════╝\n');
  console.log(`Mode: ${options.mode}`);
  console.log(`Source filter: ${options.source}`);
  console.log(`Include variable: ${options.includeVariable}`);
  if (options.limit) console.log(`Limit: ${options.limit}`);
  console.log();

  const connection = await getConnection();

  console.log('✓ Connected to database\n');

  try {
    console.log('Finding products without images...');
    const products = await findImagelessProducts(connection, options);

    if (products.length === 0) {
      console.log('✓ No imageless products found!');
      return;
    }

    const totalVariations = products.reduce((sum, p) => sum + p.variationCount, 0);
    console.log(`Found ${products.length} products without images`);
    console.log(`Total associated variations: ${totalVariations}\n`);

    // Group by source for analysis
    const bySource = new Map<string, number>();
    for (const p of products) {
      bySource.set(p.source, (bySource.get(p.source) || 0) + 1);
    }

    console.log('Breakdown by source:');
    for (const [source, count] of bySource) {
      console.log(`  ${source}: ${count}`);
    }
    console.log();

    if (options.mode === 'analyze') {
      // Show first 50 products
      const show = products.slice(0, 50);
      for (const p of show) {
        const varInfo = p.variationCount > 0 ? ` (${p.variationCount} variations)` : '';
        console.log(`  [#${p.id}] ${p.title.substring(0, 60)} — SKU: ${p.sku || 'none'} — ${p.source}${varInfo}`);
      }
      if (products.length > 50) {
        console.log(`  ... and ${products.length - 50} more`);
      }
    } else if (options.mode === 'dry-run') {
      console.log('DRY RUN — would delete:');
      for (const p of products) {
        const varInfo = p.variationCount > 0 ? ` + ${p.variationCount} variations` : '';
        console.log(`  [#${p.id}] ${p.title.substring(0, 60)}${varInfo}`);
      }
      console.log(`\nTotal: ${products.length} products + ${totalVariations} variations`);
    } else {
      // Apply
      let deleted = 0;
      let deletedVariations = 0;

      for (const p of products) {
        try {
          await deleteProduct(connection, p);
          deleted++;
          deletedVariations += p.variationCount;

          if (deleted % 100 === 0) {
            console.log(`  Progress: ${deleted}/${products.length} deleted...`);
          }
        } catch (error) {
          console.error(`  ✗ Failed to delete #${p.id}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
      }

      console.log(`\n✓ Deleted ${deleted} products and ${deletedVariations} variations`);
    }
  } finally {
    await connection.end();
  }

  console.log('\n✓ Done');
}

main().catch(error => {
  console.error('\n✗ Failed:', error);
  process.exit(1);
});
