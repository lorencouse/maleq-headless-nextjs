#!/usr/bin/env bun

/**
 * Backfill _wt_sku (Williams Trading warehouse SKU) on all product variations.
 *
 * Resolves each variation's _sku (barcode/UPC) to the warehouse SKU via
 * the Williams XML and STC CSV product feeds, then writes _wt_sku as postmeta.
 *
 * Usage:
 *   bun scripts/backfill-wt-sku.ts [mode] [options]
 *
 * Modes:
 *   --analyze     Count how many can be resolved (default)
 *   --dry-run     Show what would be written
 *   --apply       Write _wt_sku to database
 *
 * Options:
 *   --local       Connect to local DB
 *   --limit <n>   Limit number of variations to process
 *   --verbose     Print extra debug info
 *   --help, -h    Show help
 */

import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';

// ==================== TYPES ====================

interface ScriptOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  limit?: number;
  verbose: boolean;
}

// ==================== ARGUMENT PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const opts: ScriptOptions = { mode: 'analyze', verbose: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--analyze': opts.mode = 'analyze'; break;
      case '--dry-run': opts.mode = 'dry-run'; break;
      case '--apply': opts.mode = 'apply'; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--verbose': opts.verbose = true; break;
      case '--help': case '-h':
        console.log(`
Backfill _wt_sku on product variations
=======================================
Resolves barcode (_sku) → warehouse SKU via product feeds,
then writes _wt_sku as postmeta on each variation.

Modes:
  --analyze   Count resolvable variations (default)
  --dry-run   Show what would be written
  --apply     Write to database

Options:
  --local     Connect to local DB
  --limit <n> Limit variations to process
  --verbose   Extra debug output
`);
        process.exit(0);
      case '--local': case '--remote': break;
      case '--db': i++; break;
    }
  }
  return opts;
}

// ==================== FEED PARSING ====================

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';
const WILLIAMS_XML_FILES = [
  `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
];
const STC_CSV_FILE = `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`;

function extractXmlField(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

async function parseWilliamsXml(
  filePath: string,
  barcodeMap: Map<string, string>
): Promise<number> {
  if (!existsSync(filePath)) {
    console.log(`  [skip] File not found: ${filePath}`);
    return 0;
  }

  const fileSize = `${(Bun.file(filePath).size / 1024 / 1024).toFixed(1)}MB`;
  console.log(`  Parsing ${filePath.split('/').pop()} (${fileSize})...`);

  return new Promise<number>((resolve, reject) => {
    let count = 0;
    let inProduct = false;
    let buffer = '';

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      buffer += line + '\n';

      if (line.includes('<product ') || line.trim() === '<product>') {
        inProduct = true;
        buffer = line + '\n';
      }

      if (inProduct && line.includes('</product>')) {
        const block = buffer;
        const sku = extractXmlField(block, 'sku');
        const barcode = extractXmlField(block, 'barcode');

        if (sku && barcode && !barcodeMap.has(barcode)) {
          barcodeMap.set(barcode, sku);
          count++;
        }

        inProduct = false;
        buffer = '';
      }
    });

    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

async function parseStcCsv(
  filePath: string,
  barcodeMap: Map<string, string>
): Promise<number> {
  if (!existsSync(filePath)) {
    console.log(`  [skip] File not found: ${filePath}`);
    return 0;
  }

  const fileSize = `${(Bun.file(filePath).size / 1024 / 1024).toFixed(1)}MB`;
  console.log(`  Parsing ${filePath.split('/').pop()} (${fileSize})...`);

  return new Promise<number>((resolve, reject) => {
    let count = 0;

    const parser = createReadStream(filePath, { encoding: 'utf-8' }).pipe(
      parse({ columns: true, skip_empty_lines: true, relax_column_count: true, trim: true })
    );

    parser.on('data', (row: Record<string, string>) => {
      const handle = (row['Handle'] || '').trim();
      const upc = (row['UPC'] || '').trim();

      if (upc && handle && !barcodeMap.has(upc)) {
        barcodeMap.set(upc, handle);
        count++;
      }
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}

async function buildBarcodeMap(): Promise<Map<string, string>> {
  console.log('\n--- Building barcode → warehouse SKU map from feeds ---');
  const barcodeMap = new Map<string, string>();

  for (const xmlFile of WILLIAMS_XML_FILES) {
    const count = await parseWilliamsXml(xmlFile, barcodeMap);
    console.log(`    -> ${count.toLocaleString()} barcode mappings`);
  }

  const stcCount = await parseStcCsv(STC_CSV_FILE, barcodeMap);
  console.log(`    -> ${stcCount.toLocaleString()} STC barcode mappings`);
  console.log(`  Total barcode→warehouseSku mappings: ${barcodeMap.size.toLocaleString()}`);

  return barcodeMap;
}

// ==================== MAIN ====================

async function main() {
  const opts = parseArgs();
  console.log(`\nBackfill _wt_sku - Mode: ${opts.mode.toUpperCase()}`);
  console.log('='.repeat(60));

  const barcodeMap = await buildBarcodeMap();

  const db = await getConnection();

  try {
    // Load all variations with _sku but WITHOUT _wt_sku
    console.log('\n--- Loading variations needing _wt_sku ---');

    let query = `
      SELECT v.ID as var_id, sku_meta.meta_value as barcode
      FROM wp_posts v
      JOIN wp_postmeta sku_meta ON sku_meta.post_id = v.ID
        AND sku_meta.meta_key = '_sku'
        AND sku_meta.meta_value IS NOT NULL AND sku_meta.meta_value != ''
      LEFT JOIN wp_postmeta wt_meta ON wt_meta.post_id = v.ID
        AND wt_meta.meta_key = '_wt_sku'
      WHERE v.post_type = 'product_variation'
        AND (wt_meta.meta_value IS NULL OR wt_meta.meta_value = '')
    `;
    if (opts.limit) query += ` LIMIT ${opts.limit}`;

    const [rows] = await db.query<RowDataPacket[]>(query);
    console.log(`  Variations with _sku but no _wt_sku: ${rows.length.toLocaleString()}`);

    // Also count how many already have _wt_sku
    const [existingRows] = await db.query<RowDataPacket[]>(`
      SELECT COUNT(*) as cnt FROM wp_postmeta
      WHERE meta_key = '_wt_sku' AND meta_value IS NOT NULL AND meta_value != ''
    `);
    console.log(`  Variations already with _wt_sku: ${existingRows[0].cnt.toLocaleString()}`);

    // Resolve barcodes
    let resolved = 0;
    let unresolved = 0;
    const toWrite: Array<{ varId: number; barcode: string; warehouseSku: string }> = [];

    for (const row of rows) {
      const warehouseSku = barcodeMap.get(row.barcode);
      if (warehouseSku) {
        toWrite.push({ varId: row.var_id, barcode: row.barcode, warehouseSku });
        resolved++;
      } else {
        unresolved++;
        if (opts.verbose && unresolved <= 20) {
          console.log(`    Unresolved: var ${row.var_id} barcode="${row.barcode}"`);
        }
      }
    }

    console.log(`\n  Resolvable:   ${resolved.toLocaleString()}`);
    console.log(`  Unresolvable: ${unresolved.toLocaleString()}`);

    if (opts.mode === 'dry-run') {
      console.log(`\n--- DRY RUN: first 30 writes ---`);
      for (const item of toWrite.slice(0, 30)) {
        console.log(`  INSERT _wt_sku = "${item.warehouseSku}" on var ${item.varId} (barcode: ${item.barcode})`);
      }
      if (toWrite.length > 30) {
        console.log(`  ... and ${toWrite.length - 30} more`);
      }
    }

    if (opts.mode === 'apply') {
      console.log(`\n--- Applying ${toWrite.length.toLocaleString()} _wt_sku writes ---`);

      // Check if any already have a _wt_sku meta row (empty value) vs no row at all
      const varIds = toWrite.map(t => t.varId);

      // Batch in chunks of 500
      const BATCH = 500;
      let written = 0;
      let updated = 0;

      for (let i = 0; i < toWrite.length; i += BATCH) {
        const batch = toWrite.slice(i, i + BATCH);
        const batchIds = batch.map(b => b.varId);

        // Find which ones already have an empty _wt_sku row
        const [existingMeta] = await db.query<RowDataPacket[]>(`
          SELECT post_id FROM wp_postmeta
          WHERE post_id IN (${batchIds.join(',')}) AND meta_key = '_wt_sku'
        `);
        const hasRow = new Set(existingMeta.map((r: any) => r.post_id));

        await db.beginTransaction();
        try {
          for (const item of batch) {
            if (hasRow.has(item.varId)) {
              await db.query(
                `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_wt_sku'`,
                [item.warehouseSku, item.varId]
              );
              updated++;
            } else {
              await db.query(
                `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wt_sku', ?)`,
                [item.varId, item.warehouseSku]
              );
              written++;
            }
          }
          await db.commit();
        } catch (err) {
          await db.rollback();
          throw err;
        }

        if ((i + BATCH) % 2000 === 0 || i + BATCH >= toWrite.length) {
          console.log(`  Progress: ${Math.min(i + BATCH, toWrite.length).toLocaleString()} / ${toWrite.length.toLocaleString()}`);
        }
      }

      console.log(`\n  Done!`);
      console.log(`    New _wt_sku inserted: ${written.toLocaleString()}`);
      console.log(`    Empty _wt_sku updated: ${updated.toLocaleString()}`);

      // Verify
      const [verifyRows] = await db.query<RowDataPacket[]>(`
        SELECT COUNT(*) as cnt FROM wp_postmeta
        WHERE meta_key = '_wt_sku' AND meta_value IS NOT NULL AND meta_value != ''
      `);
      console.log(`    Total _wt_sku in DB now: ${verifyRows[0].cnt.toLocaleString()}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
