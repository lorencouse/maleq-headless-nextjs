#!/usr/bin/env bun

/**
 * Enrich Products with STC Data (Fill Missing Fields Only)
 *
 * After importing products from MUFFS inactive XML, this script fills in
 * gaps using STC feed data. MUFFS is always the source of truth — STC data
 * only fills fields that are empty/missing.
 *
 * What it does:
 *   1. Appends 'stc' to _product_source (preserves existing 'williams_trading')
 *   2. Fills missing post_content (description) from STC
 *   3. Fills missing product_brand taxonomy from STC brand name
 *   4. Fills missing Color/Material in _product_attributes from STC
 *   5. Ensures _sku is set to UPC for all matched products
 *
 * Usage:
 *   bun scripts/enrich-stc-metadata.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to process
 *   --dry-run             Show what would be updated without making changes
 *   --barcode-file <path> Only process products matching barcodes in file
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { getConnection } from './lib/db';
import type { Connection } from 'mysql2/promise';

interface STCProduct {
  handle: string;
  upc: string;
  name: string;
  description: string;
  brand: string;
  features: string;
  functions: string;
  material: string;
  color: string;
}

interface EnrichOptions {
  limit?: number;
  dryRun: boolean;
  barcodeFile?: string;
}

interface EnrichStats {
  scanned: number;
  enriched: number;
  skipped: number;
  skuFixed: number;
  sourceUpdated: number;
  descriptionFilled: number;
  brandLinked: number;
  colorFilled: number;
  materialFilled: number;
  parentEnriched: number;
}

function parseArgs(): EnrichOptions {
  const args = process.argv.slice(2);
  const options: EnrichOptions = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--barcode-file' && i + 1 < args.length) {
      options.barcodeFile = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Enrich Products with STC Data (Fill Missing Fields Only)

MUFFS is source of truth. STC only fills gaps.

Usage:
  bun scripts/enrich-stc-metadata.ts [options]

Options:
  --limit <n>           Limit number of products to process
  --dry-run             Show what would be updated without making changes
  --barcode-file <path> Only process products matching barcodes in file
  --help, -h            Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Load STC products from CSV, keyed by UPC
 */
function loadSTCProducts(): Map<string, STCProduct> {
  const csvPath = join(process.cwd(), 'data', 'stc-product-feed.csv');
  const content = readFileSync(csvPath, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });

  const products = new Map<string, STCProduct>();
  for (const row of records) {
    const upc = (row['UPC'] || '').trim();
    if (!upc) continue;

    products.set(upc, {
      handle: (row['Handle'] || '').trim(),
      upc,
      name: (row['Product Name'] || '').trim(),
      description: (row['Description'] || '').trim(),
      brand: (row['Brand'] || '').trim(),
      features: (row['Features'] || '').trim(),
      functions: (row['Functions'] || '').trim(),
      material: (row['Material'] || '').trim(),
      color: (row['Color'] || '').trim(),
    });
  }

  return products;
}

/**
 * Build a map of brand name (lowercase) → term_taxonomy_id for product_brand taxonomy
 */
async function loadBrandLookup(db: Connection): Promise<Map<string, number>> {
  const [rows] = await db.execute(`
    SELECT t.name, tt.term_taxonomy_id
    FROM wp_terms t
    INNER JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
    WHERE tt.taxonomy = 'product_brand'
  `);

  const lookup = new Map<string, number>();
  for (const row of rows as any[]) {
    lookup.set(row.name.toLowerCase().trim(), row.term_taxonomy_id);
  }
  return lookup;
}

/**
 * Check if a product already has a product_brand linked
 */
async function hasBrand(db: Connection, postId: number): Promise<boolean> {
  const [rows] = await db.execute(`
    SELECT 1 FROM wp_term_relationships tr
    INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    WHERE tr.object_id = ? AND tt.taxonomy = 'product_brand'
    LIMIT 1
  `, [postId]);
  return (rows as any[]).length > 0;
}

/**
 * Link a product to a brand by term_taxonomy_id
 */
async function linkBrand(db: Connection, postId: number, termTaxonomyId: number): Promise<void> {
  await db.execute(
    `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
    [postId, termTaxonomyId]
  );
  await db.execute(
    `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
    [termTaxonomyId]
  );
}

/**
 * Get existing _product_attributes for a product (returns null if none)
 */
async function getProductAttributes(db: Connection, postId: number): Promise<string | null> {
  const [rows] = await db.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
    [postId]
  );
  const result = rows as any[];
  return result.length > 0 ? result[0].meta_value : null;
}

/**
 * Check if serialized _product_attributes contains a given attribute key
 */
function hasAttribute(serialized: string, attrName: string): boolean {
  // Check for the attribute key in the serialized PHP string
  const keyLower = attrName.toLowerCase();
  return serialized.includes(`"${keyLower}"`);
}

function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Serialize product attributes to PHP format for WooCommerce
 */
function serializeProductAttributes(
  attributes: Record<string, { name: string; value: string; position: number; is_visible: number; is_variation: number; is_taxonomy: number }>
): string {
  const entries = Object.entries(attributes);
  let result = `a:${entries.length}:{`;

  for (const [key, attr] of entries) {
    const keyLower = key.toLowerCase();
    result += `s:${keyLower.length}:"${keyLower}";`;
    result += `a:6:{`;
    result += `s:4:"name";s:${attr.name.length}:"${attr.name}";`;
    result += `s:5:"value";s:${attr.value.length}:"${attr.value}";`;
    result += `s:8:"position";i:${attr.position};`;
    result += `s:10:"is_visible";i:${attr.is_visible};`;
    result += `s:12:"is_variation";i:${attr.is_variation};`;
    result += `s:11:"is_taxonomy";i:${attr.is_taxonomy};`;
    result += `}`;
  }

  result += `}`;
  return result;
}

/**
 * Get or update a meta value (only if not already set)
 */
async function getMetaValue(db: Connection, postId: number, metaKey: string): Promise<string | null> {
  const [rows] = await db.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
    [postId, metaKey]
  );
  const result = rows as any[];
  return result.length > 0 && result[0].meta_value ? result[0].meta_value : null;
}

async function setMeta(db: Connection, postId: number, metaKey: string, metaValue: string): Promise<void> {
  const [existing] = await db.execute(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
    [postId, metaKey]
  );

  if ((existing as any[]).length > 0) {
    await db.execute(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?`,
      [metaValue, postId, metaKey]
    );
  } else {
    await db.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
      [postId, metaKey, metaValue]
    );
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Enrich Products with STC Data             ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log('  Mode: Fill missing fields only (MUFFS = source of truth)');
  if (options.limit) console.log(`  Limit: ${options.limit}`);
  if (options.barcodeFile) console.log(`  Barcode File: ${options.barcodeFile}`);

  // Load STC feed
  console.log('\nLoading STC product feed...');
  const stcProducts = loadSTCProducts();
  console.log(`  ✓ ${stcProducts.size} products loaded from STC feed`);

  // Load barcode filter if specified
  let barcodeFilter: Set<string> | null = null;
  if (options.barcodeFile) {
    const content = readFileSync(options.barcodeFile, 'utf-8');
    barcodeFilter = new Set(
      content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    );
    console.log(`  ✓ ${barcodeFilter.size} barcodes loaded from filter file`);
  }

  // Connect to database
  const db = await getConnection();
  console.log('  ✓ Connected to database');

  // Load brand lookup
  console.log('Loading brand taxonomy...');
  const brandLookup = await loadBrandLookup(db);
  console.log(`  ✓ ${brandLookup.size} brands in product_brand taxonomy`);

  // Find products to enrich (include post_parent for variation→parent propagation)
  let query = `
    SELECT DISTINCT
      p.ID as postId,
      p.post_title as title,
      p.post_content as description,
      p.post_type as postType,
      p.post_parent as parentId,
      pm_sku.meta_value as sku,
      pm_barcode.meta_value as barcode
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm_sku ON p.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
    LEFT JOIN wp_postmeta pm_barcode ON p.ID = pm_barcode.post_id AND pm_barcode.meta_key = '_wt_barcode'
    WHERE p.post_type IN ('product', 'product_variation')
    AND p.post_status IN ('publish', 'draft')
    ORDER BY p.ID
  `;

  if (options.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  console.log('\nFinding products to enrich...');
  const [rows] = await db.execute(query);
  const products = rows as any[];
  console.log(`  ✓ ${products.length} products found in database`);

  const stats: EnrichStats = {
    scanned: 0,
    enriched: 0,
    skipped: 0,
    skuFixed: 0,
    sourceUpdated: 0,
    descriptionFilled: 0,
    brandLinked: 0,
    colorFilled: 0,
    materialFilled: 0,
    parentEnriched: 0,
  };

  // Track which parent products we've already enriched (avoid doing it once per variation)
  const enrichedParents = new Set<number>();

  for (const product of products) {
    stats.scanned++;

    // Match by barcode or SKU to STC UPC
    const upc = product.barcode || product.sku;
    if (!upc) { stats.skipped++; continue; }

    // Apply barcode filter if specified
    if (barcodeFilter && !barcodeFilter.has(upc)) { stats.skipped++; continue; }

    const stc = stcProducts.get(upc);
    if (!stc) { stats.skipped++; continue; }

    const isVariation = product.postType === 'product_variation';
    let changed = false;

    if (options.dryRun && stats.enriched < 10) {
      console.log(`  [DRY RUN] Would enrich: ${product.title || '(variation)'} (${upc})${isVariation ? ` → parent ${product.parentId}` : ''}`);
    }

    // 1. Ensure _sku is set to UPC
    if (product.sku !== upc) {
      if (!options.dryRun) await setMeta(db, product.postId, '_sku', upc);
      stats.skuFixed++;
      changed = true;
    }

    // 2. Update _product_source on the product itself
    const currentSource = await getMetaValue(db, product.postId, '_product_source');
    if (!currentSource) {
      if (!options.dryRun) await setMeta(db, product.postId, '_product_source', 'williams_trading,stc');
      stats.sourceUpdated++;
      changed = true;
    } else if (!currentSource.includes('stc')) {
      if (!options.dryRun) await setMeta(db, product.postId, '_product_source', `${currentSource},stc`);
      stats.sourceUpdated++;
      changed = true;
    }

    // For variations: propagate brand, description, and source to parent product
    // (parent is synthetic with no UPC — it won't match STC directly)
    if (isVariation && product.parentId && !enrichedParents.has(product.parentId)) {
      enrichedParents.add(product.parentId);

      // Propagate _product_source to parent
      const parentSource = await getMetaValue(db, product.parentId, '_product_source');
      if (!parentSource) {
        if (!options.dryRun) await setMeta(db, product.parentId, '_product_source', 'williams_trading,stc');
        stats.sourceUpdated++;
      } else if (!parentSource.includes('stc')) {
        if (!options.dryRun) await setMeta(db, product.parentId, '_product_source', `${parentSource},stc`);
        stats.sourceUpdated++;
      }

      // Fill missing parent description from STC
      const [parentRows] = await db.execute(
        `SELECT post_content FROM wp_posts WHERE ID = ?`, [product.parentId]
      );
      const parentDesc = (parentRows as any[])[0]?.post_content;
      if (!parentDesc && stc.description) {
        if (!options.dryRun) {
          await db.execute(
            `UPDATE wp_posts SET post_content = ? WHERE ID = ?`,
            [stc.description, product.parentId]
          );
        }
        stats.descriptionFilled++;
      }

      // Fill missing parent brand from STC
      if (stc.brand) {
        const parentHasBrand = await hasBrand(db, product.parentId);
        if (!parentHasBrand) {
          const termTaxId = brandLookup.get(stc.brand.toLowerCase().trim());
          if (termTaxId) {
            if (!options.dryRun) await linkBrand(db, product.parentId, termTaxId);
            stats.brandLinked++;
          }
        }
      }

      stats.parentEnriched++;
      changed = true;
    }

    // For simple products (not variations): handle description, brand, attributes directly
    if (!isVariation) {
      // 3. Fill missing description
      if (!product.description && stc.description) {
        if (!options.dryRun) {
          await db.execute(
            `UPDATE wp_posts SET post_content = ? WHERE ID = ?`,
            [stc.description, product.postId]
          );
        }
        stats.descriptionFilled++;
        changed = true;
      }

      // 4. Fill missing brand
      if (stc.brand) {
        const alreadyHasBrand = await hasBrand(db, product.postId);
        if (!alreadyHasBrand) {
          const termTaxId = brandLookup.get(stc.brand.toLowerCase().trim());
          if (termTaxId) {
            if (!options.dryRun) await linkBrand(db, product.postId, termTaxId);
            stats.brandLinked++;
            changed = true;
          }
        }
      }

      // 5. Fill missing Color/Material in _product_attributes (simple products only)
      if (stc.color || stc.material) {
        const existingAttrs = await getProductAttributes(db, product.postId);

        // Only add attributes to products that have none yet
        // (MUFFS import would have set these if they existed in the XML)
        if (!existingAttrs) {
          const attrs: Record<string, { name: string; value: string; position: number; is_visible: number; is_variation: number; is_taxonomy: number }> = {};
          let position = 0;

          if (stc.color) {
            attrs['Color'] = {
              name: 'Color',
              value: titleCase(stc.color),
              position: position++,
              is_visible: 1,
              is_variation: 0,
              is_taxonomy: 0,
            };
            stats.colorFilled++;
          }
          if (stc.material) {
            attrs['Material'] = {
              name: 'Material',
              value: titleCase(stc.material),
              position: position++,
              is_visible: 1,
              is_variation: 0,
              is_taxonomy: 0,
            };
            stats.materialFilled++;
          }

          if (Object.keys(attrs).length > 0) {
            const serialized = serializeProductAttributes(attrs);
            if (!options.dryRun) {
              await db.execute(
                `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
                [product.postId, serialized]
              );
            }
            changed = true;
          }
        }
      }
    }

    if (changed) stats.enriched++;
    else stats.skipped++;

    // Progress
    if (stats.scanned % 1000 === 0) {
      console.log(`  ... scanned ${stats.scanned}/${products.length}`);
    }
  }

  // Summary
  console.log('\n=== ENRICHMENT SUMMARY ===');
  console.log(`Products scanned:       ${stats.scanned}`);
  console.log(`Products enriched:      ${stats.enriched}`);
  console.log(`Products skipped:       ${stats.skipped}`);
  console.log(`  SKU set to UPC:       ${stats.skuFixed}`);
  console.log(`  Source updated:        ${stats.sourceUpdated}`);
  console.log(`  Description filled:   ${stats.descriptionFilled}`);
  console.log(`  Brand linked:         ${stats.brandLinked}`);
  console.log(`  Color filled:         ${stats.colorFilled}`);
  console.log(`  Material filled:      ${stats.materialFilled}`);
  console.log(`  Parents enriched:     ${stats.parentEnriched}`);
  if (options.dryRun) {
    console.log('\n(Dry run - no changes were made)');
  }

  await db.end();
  console.log('\n✓ Done');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
