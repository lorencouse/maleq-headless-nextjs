#!/usr/bin/env bun

/**
 * Generate Missed Product Barcodes
 *
 * Cross-references three data sources to find products that:
 * 1. Exist in STC feed (active on STC)
 * 2. Exist in MUFFS inactive list (inactive in MUFFS XML)
 * 3. Are NOT already in the database
 *
 * Logic: (STC UPCs ∩ inactive SKUs) - DB SKUs
 *
 * Output: data/missed-product-barcodes.txt (one UPC per line)
 *
 * Usage:
 *   bun scripts/generate-missed-barcodes.ts [options]
 *
 * Options:
 *   --output <path>   Output file path (default: data/missed-product-barcodes.txt)
 *   --stats           Print detailed statistics only, no file output
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { getConnection } from './lib/db';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: join(process.cwd(), 'data', 'missed-product-barcodes.txt'),
    statsOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' && i + 1 < args.length) {
      options.output = args[i + 1];
      i++;
    } else if (arg === '--stats') {
      options.statsOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Generate Missed Product Barcodes

Cross-references STC feed, inactive SKUs, and DB to find missing products.
Logic: (STC UPCs ∩ inactive SKUs) - DB SKUs

Usage:
  bun scripts/generate-missed-barcodes.ts [options]

Options:
  --output <path>   Output file path (default: data/missed-product-barcodes.txt)
  --stats           Print detailed statistics only, no file output
  --help, -h        Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Load UPCs from STC product feed CSV (column 2 = UPC)
 */
function loadSTCUpcs(): Set<string> {
  const csvPath = join(process.cwd(), 'data', 'stc-product-feed.csv');
  const content = readFileSync(csvPath, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });

  const upcs = new Set<string>();
  for (const row of records) {
    const upc = (row['UPC'] || '').trim();
    if (upc) {
      upcs.add(upc);
    }
  }

  return upcs;
}

/**
 * Load inactive SKUs from text file (one per line)
 */
function loadInactiveSkus(): Set<string> {
  const filePath = join(process.cwd(), 'data', 'inactive-skus.txt');
  const content = readFileSync(filePath, 'utf-8');
  const skus = new Set<string>();

  for (const line of content.split('\n')) {
    const sku = line.trim();
    if (sku && !sku.startsWith('#')) {
      skus.add(sku);
    }
  }

  return skus;
}

/**
 * Load existing SKUs and barcodes from database
 */
async function loadDBSkus(): Promise<Set<string>> {
  const db = await getConnection();

  try {
    // Get all _sku and _wt_barcode values from published products
    const [rows] = await db.execute(`
      SELECT DISTINCT pm.meta_value
      FROM wp_postmeta pm
      INNER JOIN wp_posts p ON pm.post_id = p.ID
      WHERE pm.meta_key IN ('_sku', '_wt_barcode')
      AND pm.meta_value IS NOT NULL
      AND pm.meta_value != ''
      AND p.post_status IN ('publish', 'draft', 'private')
      AND p.post_type IN ('product', 'product_variation')
    `);

    const skus = new Set<string>();
    for (const row of rows as any[]) {
      skus.add(row.meta_value.trim());
    }

    return skus;
  } finally {
    await db.end();
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Generate Missed Product Barcodes          ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Step 1: Load STC UPCs
  console.log('Loading STC product feed...');
  const stcUpcs = loadSTCUpcs();
  console.log(`  ✓ ${stcUpcs.size} unique UPCs from STC feed`);

  // Step 2: Load inactive SKUs
  console.log('Loading inactive SKUs...');
  const inactiveSkus = loadInactiveSkus();
  console.log(`  ✓ ${inactiveSkus.size} inactive SKUs`);

  // Step 3: Find intersection (STC ∩ inactive)
  const stcAndInactive = new Set<string>();
  Array.from(stcUpcs).forEach(upc => {
    if (inactiveSkus.has(upc)) {
      stcAndInactive.add(upc);
    }
  });
  console.log(`  ✓ ${stcAndInactive.size} UPCs in both STC feed AND inactive list`);

  // Step 4: Load existing DB SKUs
  console.log('Loading existing DB SKUs...');
  const dbSkus = loadDBSkus();
  const dbSkuSet = await dbSkus;
  console.log(`  ✓ ${dbSkuSet.size} existing SKUs/barcodes in database`);

  // Step 5: Subtract DB SKUs
  const missed = new Set<string>();
  Array.from(stcAndInactive).forEach(upc => {
    if (!dbSkuSet.has(upc)) {
      missed.add(upc);
    }
  });

  // Print stats
  console.log('\n=== RESULTS ===');
  console.log(`STC feed UPCs:          ${stcUpcs.size}`);
  console.log(`Inactive SKUs:          ${inactiveSkus.size}`);
  console.log(`STC ∩ Inactive:         ${stcAndInactive.size}`);
  console.log(`Already in DB:          ${stcAndInactive.size - missed.size}`);
  console.log(`Missing (to import):    ${missed.size}`);

  if (options.statsOnly) {
    console.log('\n(Stats only mode - no file written)');
    return;
  }

  // Write output file
  const sortedBarcodes = Array.from(missed).sort();
  writeFileSync(options.output, sortedBarcodes.join('\n') + '\n');
  console.log(`\n✓ Wrote ${sortedBarcodes.length} barcodes to ${options.output}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
