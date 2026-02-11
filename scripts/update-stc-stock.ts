#!/usr/bin/env bun

/**
 * STC Stock Update Script (CLI — direct MySQL)
 *
 * Downloads the STC inventory CSV and updates _stock for ALL matched products.
 * STC CSV contains combined stock from both STC and Williams Trading warehouses,
 * so ALL matched products get their main _stock field updated.
 *
 * Usage:
 *   bun scripts/update-stc-stock.ts --analyze       # Show what would change (no DB writes)
 *   bun scripts/update-stc-stock.ts --dry-run       # Show detailed changes for first 50
 *   bun scripts/update-stc-stock.ts --apply         # Apply stock updates to database
 *   bun scripts/update-stc-stock.ts --apply --limit 100  # Apply to first 100 products
 */

import { getConnection } from './lib/db';
import { parse } from 'csv-parse/sync';

const STC_INVENTORY_URL =
  'https://sextoy-wholesale-datafeeds.s3.amazonaws.com/sextoywholesale-inventory.csv';

interface StcInventoryRow {
  UPC: string;
  inventory_quantity: string;
}

interface DbProduct {
  postId: number;
  postTitle: string;
  sku: string;
  barcode: string | null;
  productSource: string | null;
  currentStock: number | null;
  currentStockStatus: string | null;
}

interface StockUpdate {
  postId: number;
  postTitle: string;
  sku: string;
  source: string | null;
  currentStock: number | null;
  newStock: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function normalizeUpc(upc: string): string {
  return upc.trim().replace(/^0+/, '');
}

// ─── Fetch STC inventory CSV ────────────────────────────────────────────

async function fetchStcInventory(): Promise<Map<string, number>> {
  console.log(`\nFetching STC inventory from:\n  ${STC_INVENTORY_URL}\n`);
  const response = await fetch(STC_INVENTORY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch STC inventory: ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();
  const records: StcInventoryRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`  Parsed ${records.length.toLocaleString()} rows from STC inventory CSV`);

  const inventory = new Map<string, number>();
  for (const row of records) {
    const upc = normalizeUpc(row.UPC);
    if (!upc) continue;
    const qty = parseInt(row.inventory_quantity, 10);
    inventory.set(upc, isNaN(qty) ? 0 : qty);
  }

  console.log(`  ${inventory.size.toLocaleString()} unique UPCs with stock data`);
  return inventory;
}

// ─── Load products from DB ──────────────────────────────────────────────

async function loadProducts(db: Awaited<ReturnType<typeof getConnection>>): Promise<DbProduct[]> {
  console.log('\nLoading products from database...');

  const [rows] = await db.query<any[]>(`
    SELECT
      p.ID as postId,
      p.post_title as postTitle,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
      MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) as barcode,
      MAX(CASE WHEN pm.meta_key = '_product_source' THEN pm.meta_value END) as productSource,
      MAX(CASE WHEN pm.meta_key = '_stock' THEN CAST(pm.meta_value AS SIGNED) END) as currentStock,
      MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) as currentStockStatus
    FROM wp_posts p
    JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type IN ('product', 'product_variation')
      AND p.post_status IN ('publish', 'draft', 'private')
    GROUP BY p.ID
    HAVING sku IS NOT NULL OR barcode IS NOT NULL
  `);

  console.log(`  Loaded ${rows.length.toLocaleString()} products with SKU/barcode`);
  return rows as DbProduct[];
}

// ─── Match and compute updates ──────────────────────────────────────────

function computeUpdates(
  products: DbProduct[],
  inventory: Map<string, number>,
): StockUpdate[] {
  const updates: StockUpdate[] = [];

  for (const product of products) {
    const normalizedSku = product.sku ? normalizeUpc(product.sku) : null;
    const normalizedBarcode = product.barcode ? normalizeUpc(product.barcode) : null;

    let stcQty: number | undefined;
    if (normalizedSku && inventory.has(normalizedSku)) {
      stcQty = inventory.get(normalizedSku)!;
    } else if (normalizedBarcode && inventory.has(normalizedBarcode)) {
      stcQty = inventory.get(normalizedBarcode)!;
    }

    if (stcQty === undefined) continue;

    // STC = combined stock — update _stock for ALL matched products
    if (product.currentStock === stcQty) continue; // No change

    updates.push({
      postId: product.postId,
      postTitle: product.postTitle,
      sku: product.sku,
      source: product.productSource,
      currentStock: product.currentStock,
      newStock: stcQty,
    });
  }

  return updates;
}

// ─── Apply updates ──────────────────────────────────────────────────────

async function applyUpdates(
  db: Awaited<ReturnType<typeof getConnection>>,
  updates: StockUpdate[],
) {
  let applied = 0;
  let errors = 0;

  for (const update of updates) {
    try {
      const stockStatus = update.newStock > 0 ? 'instock' : 'outofstock';

      // Update _stock
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_stock'`,
        [update.newStock.toString(), update.postId],
      );

      // Update _stock_status
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_stock_status'`,
        [stockStatus, update.postId],
      );

      // Update WooCommerce lookup table
      await db.query(
        `UPDATE wp_wc_product_meta_lookup SET stock_quantity = ?, stock_status = ? WHERE product_id = ?`,
        [update.newStock, stockStatus, update.postId],
      );

      applied++;
    } catch (err: any) {
      errors++;
      console.error(`  Error updating product ${update.postId} (${update.sku}): ${err.message}`);
    }
  }

  return { applied, errors };
}

// ─── Reporting ──────────────────────────────────────────────────────────

function printAnalysis(updates: StockUpdate[], totalProducts: number, totalCsvUpcs: number) {
  const inStock = updates.filter((u) => u.newStock > 0).length;
  const outOfStock = updates.filter((u) => u.newStock === 0).length;
  const wtUpdates = updates.filter((u) =>
    u.source && (u.source.toLowerCase().includes('williams_trading') || u.source.toUpperCase().includes('MUFFS'))
  ).length;
  const stcOnlyUpdates = updates.length - wtUpdates;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  STC STOCK UPDATE ANALYSIS');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  STC inventory UPCs:       ${totalCsvUpcs.toLocaleString()}`);
  console.log(`  Database products:        ${totalProducts.toLocaleString()}`);
  console.log(`  Matched (need update):    ${updates.length.toLocaleString()}`);
  console.log('');
  console.log(`  All products → _stock:`);
  console.log(`    STC-only products:       ${stcOnlyUpdates.toLocaleString()}`);
  console.log(`    WT/MUFFS products:       ${wtUpdates.toLocaleString()}`);
  console.log(`    → In stock:              ${inStock.toLocaleString()}`);
  console.log(`    → Out of stock:          ${outOfStock.toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════\n');
}

function printDetailedUpdates(updates: StockUpdate[], limit: number) {
  const shown = updates.slice(0, limit);
  console.log(`\nShowing ${shown.length} of ${updates.length} updates:\n`);

  for (const u of shown) {
    const tag = u.source ? `[${u.source}]` : '[STC]';
    console.log(`  ${tag} #${u.postId} "${u.postTitle}" (${u.sku})`);
    console.log(`           _stock: ${u.currentStock ?? 'null'} → ${u.newStock}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--'));
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : undefined;

  if (!mode || !['--analyze', '--dry-run', '--apply'].includes(mode)) {
    console.log('Usage:');
    console.log('  bun scripts/update-stc-stock.ts --analyze       # Show summary');
    console.log('  bun scripts/update-stc-stock.ts --dry-run       # Show first 50 changes');
    console.log('  bun scripts/update-stc-stock.ts --apply         # Apply all updates');
    console.log('  bun scripts/update-stc-stock.ts --apply --limit N');
    process.exit(1);
  }

  // Fetch STC inventory
  const inventory = await fetchStcInventory();

  // Connect to DB and load products
  const db = await getConnection();
  try {
    const products = await loadProducts(db);

    // Compute updates
    const allUpdates = computeUpdates(products, inventory);
    const updates = limit ? allUpdates.slice(0, limit) : allUpdates;

    // Report
    printAnalysis(allUpdates, products.length, inventory.size);

    if (mode === '--dry-run') {
      printDetailedUpdates(updates, 50);
    }

    if (mode === '--apply') {
      console.log(`Applying ${updates.length.toLocaleString()} updates...`);
      const result = await applyUpdates(db, updates);
      console.log(`\n  Applied: ${result.applied.toLocaleString()}`);
      console.log(`  Errors:  ${result.errors.toLocaleString()}`);
    }
  } finally {
    await db.end();
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
