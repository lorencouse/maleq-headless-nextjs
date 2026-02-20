/**
 * Feed Index — Phase 1: Parse product feeds, build unified lookup index.
 *
 * Consolidates the duplicated feed parsing from split-variation-products.ts,
 * fix-duplicate-variations.ts, enforce-single-attribute.ts, and detect-missed-variations.ts.
 */

import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import type { FeedProduct, FeedIndex, FeedSource } from './types';

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';

const FEED_PATHS = {
  williamsActive: `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  williamsInactive: `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
  stc: `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`,
};

/**
 * Build the complete feed index from all product feed files.
 * This is the single entry point — call once at pipeline start.
 */
export async function buildFeedIndex(): Promise<FeedIndex> {
  console.log('\n--- Phase 1: Building feed index from product feeds ---');

  const skuLookup = new Map<string, FeedProduct>();
  const barcodeToWtSku = new Map<string, string>();
  const williamsActiveSkus = new Set<string>();
  const stcIdentifiers = new Set<string>();
  const discontinuedSkus = new Set<string>();

  // 1. Parse active Williams XML (highest priority)
  const activeCount = await parseWilliamsXml(
    FEED_PATHS.williamsActive, skuLookup, barcodeToWtSku, 'williams-active'
  );
  // Track active SKUs
  for (const [sku, product] of skuLookup) {
    if (product.source === 'williams-active') {
      williamsActiveSkus.add(sku);
    }
  }
  console.log(`  Active Williams: ${activeCount.toLocaleString()} products (${williamsActiveSkus.size} SKUs)`);

  // 2. Parse inactive Williams XML
  const inactiveSkusBefore = skuLookup.size;
  const inactiveCount = await parseWilliamsXml(
    FEED_PATHS.williamsInactive, skuLookup, barcodeToWtSku, 'williams-inactive'
  );
  console.log(`  Inactive Williams: ${inactiveCount.toLocaleString()} products`);

  // 3. Parse STC CSV
  const stcCount = await parseStcCsv(FEED_PATHS.stc, skuLookup, barcodeToWtSku, stcIdentifiers);
  console.log(`  STC: ${stcCount.toLocaleString()} products (${stcIdentifiers.size} identifiers)`);

  // 4. Build discontinued set: in inactive AND NOT in active AND NOT in STC
  for (const [sku, product] of skuLookup) {
    if (product.source === 'williams-inactive') {
      if (!williamsActiveSkus.has(sku) && !stcIdentifiers.has(sku)) {
        // Also check by barcode against STC
        const barcode = product.barcode;
        if (!barcode || !stcIdentifiers.has(barcode)) {
          discontinuedSkus.add(sku);
        }
      }
    }
  }
  console.log(`  Truly discontinued: ${discontinuedSkus.size.toLocaleString()} SKUs`);
  console.log(`  Total index entries: ${skuLookup.size.toLocaleString()}`);
  console.log(`  Barcode→SKU mappings: ${barcodeToWtSku.size.toLocaleString()}`);

  return { skuLookup, barcodeToWtSku, williamsActiveSkus, stcIdentifiers, discontinuedSkus };
}

/**
 * Resolve a variation's SKU to a feed product.
 * Tries: warehouseSku → barcode lookup → direct SKU lookup.
 */
export function resolveFeedProduct(
  feedIndex: FeedIndex,
  warehouseSku: string,
  barcodeSku: string
): FeedProduct | undefined {
  // Direct warehouse SKU lookup
  if (warehouseSku) {
    const product = feedIndex.skuLookup.get(warehouseSku);
    if (product) return product;
  }

  // Try barcode → warehouse SKU → product
  if (barcodeSku) {
    const resolvedWtSku = feedIndex.barcodeToWtSku.get(barcodeSku);
    if (resolvedWtSku) {
      const product = feedIndex.skuLookup.get(resolvedWtSku);
      if (product) return product;
    }
    // Direct barcode lookup
    const product = feedIndex.skuLookup.get(barcodeSku);
    if (product) return product;
  }

  return undefined;
}

/**
 * Check if a warehouse SKU is discontinued.
 */
export function isDiscontinued(
  feedIndex: FeedIndex,
  warehouseSku: string,
  barcodeSku: string
): boolean {
  if (warehouseSku && feedIndex.discontinuedSkus.has(warehouseSku)) return true;
  // Also check by resolving barcode → warehouse SKU
  if (barcodeSku) {
    const resolvedWtSku = feedIndex.barcodeToWtSku.get(barcodeSku);
    if (resolvedWtSku && feedIndex.discontinuedSkus.has(resolvedWtSku)) return true;
  }
  return false;
}

/**
 * Resolve a variation's warehouse SKU from DB _wt_sku or by barcode lookup.
 */
export function resolveWarehouseSku(
  feedIndex: FeedIndex,
  dbWtSku: string,
  dbSku: string
): string {
  if (dbWtSku) return dbWtSku;
  if (dbSku) {
    return feedIndex.barcodeToWtSku.get(dbSku) || '';
  }
  return '';
}

// ==================== XML Parsing ====================

function extractXmlField(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

function extractXmlCdata(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

async function parseWilliamsXml(
  filePath: string,
  skuMap: Map<string, FeedProduct>,
  barcodeMap: Map<string, string>,
  sourceTag: FeedSource
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
        if (sku) {
          const barcode = extractXmlField(block, 'barcode');
          const product: FeedProduct = {
            sku,
            barcode,
            name: extractXmlCdata(block, 'name') || extractXmlField(block, 'name') || '',
            color: extractXmlField(block, 'color') || '',
            material: extractXmlField(block, 'material') || '',
            height: extractXmlField(block, 'height') || '',
            length: extractXmlField(block, 'length') || '',
            diameter: extractXmlField(block, 'diameter') || '',
            weight: extractXmlField(block, 'weight') || '',
            size: '',
            description: extractXmlCdata(block, 'description') || '',
            source: sourceTag,
          };

          if (!skuMap.has(sku)) {
            skuMap.set(sku, product);
            count++;
          }

          if (barcode && !barcodeMap.has(barcode)) {
            barcodeMap.set(barcode, sku);
          }
        }

        inProduct = false;
        buffer = '';
      }
    });

    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

// ==================== CSV Parsing ====================

async function parseStcCsv(
  filePath: string,
  skuMap: Map<string, FeedProduct>,
  barcodeMap: Map<string, string>,
  stcIdentifiers: Set<string>
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
      parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      })
    );

    parser.on('data', (row: Record<string, string>) => {
      const handle = (row['Handle'] || '').trim();
      const upc = (row['UPC'] || '').trim();
      const name = (row['Product Name'] || '').trim();

      if (!handle && !upc) return;

      const product: FeedProduct = {
        sku: handle,
        barcode: upc,
        name,
        color: (row['Color'] || '').trim(),
        material: (row['Material'] || '').trim(),
        size: (row['Size'] || '').trim(),
        height: (row['Height'] || '').trim(),
        length: (row['Length'] || '').trim(),
        diameter: '',
        weight: (row['Weight'] || '').trim(),
        description: (row['Description'] || '').trim(),
        source: 'stc',
      };

      // Track all STC identifiers for discontinued detection
      if (handle) stcIdentifiers.add(handle);
      if (upc) stcIdentifiers.add(upc);

      if (handle && !skuMap.has(handle)) {
        skuMap.set(handle, product);
        count++;
      }
      if (upc && !skuMap.has(upc)) {
        skuMap.set(upc, { ...product, sku: upc });
      }
      if (upc && handle && !barcodeMap.has(upc)) {
        barcodeMap.set(upc, handle);
      }
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}
