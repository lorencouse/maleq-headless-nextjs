#!/usr/bin/env bun

/**
 * Fix Duplicate Product Variations in WooCommerce
 *
 * Finds variations that share the same attribute values under the same parent,
 * looks up their SKUs in the original product feed files to determine the real
 * differentiating attribute, then updates the database.
 *
 * Usage:
 *   bun scripts/fix-duplicate-variations.ts [mode] [options]
 *
 * Modes:
 *   --analyze         Analyze and report (default). Writes JSON report.
 *   --dry-run         Show exact SQL that would run
 *   --apply           Execute fixes in a transaction
 *
 * Options:
 *   --local           Connect to local DB (default is remote via SSH tunnel)
 *   --output <file>   JSON report path (default: scripts/output/fix-report.json)
 *   --limit <n>       Limit number of parent products to process
 *   --parent <id>     Only process a specific parent product ID
 *   --verbose         Print extra debug info
 *   --help, -h        Show help
 */

import { createReadStream, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getConnection } from './lib/db';

// ==================== TYPES ====================

interface FeedProduct {
  sku: string;
  name: string;
  color: string;
  material: string;
  size: string;
  height: string;
  length: string;
  diameter: string;
  weight: string;
  description: string;
  source: 'williams' | 'stc';
}

interface VariationInfo {
  varId: number;
  parentId: number;
  varTitle: string;
  varSlug: string;
  varStatus: string;
  parentTitle: string;
  parentSlug: string;
  sku: string;
  attrs: Map<string, string>; // meta_key -> meta_value
}

interface DuplicateSet {
  attrKey: string;         // The shared attribute combo key
  attrPairs: [string, string][]; // The actual attribute pairs
  variationIds: number[];
}

interface ParentDuplicates {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  productAttributes: Record<string, ProductAttribute>; // from _product_attributes
  duplicateSets: DuplicateSet[];
}

interface ProductAttribute {
  name: string;
  value: string;
  position: number;
  is_visible: number;
  is_variation: number;
  is_taxonomy: number;
}

type DifferentiatorType = 'size' | 'color' | 'formula' | 'variant' | 'unknown';

interface ClassifiedDifferentiator {
  type: DifferentiatorType;
  value: string;           // The extracted attribute value (e.g., "Small", "Red", "Silicone")
  fullText: string;        // The original differentiator text
}

interface FixAction {
  variationId: number;
  sku: string;
  feedName: string;
  oldAttrValue: string;
  newAttrValue: string;
  newAttrSlug: string;
  attrMetaKey: string;        // e.g. attribute_pa_size
  attrTaxonomy: string;       // e.g. pa_size
  termNeedsCreation: boolean;
  isNewAttribute: boolean;    // true if this attribute dimension doesn't exist on the variation yet
  parentNeedsAttrUpdate: boolean; // true if parent _product_attributes needs updating
}

interface FixReport {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  duplicateSets: Array<{
    attrKey: string;
    variationCount: number;
    fixes: FixAction[];
    unfixable: Array<{ variationId: number; sku: string; reason: string }>;
  }>;
}

interface AnalysisReport {
  timestamp: string;
  summary: {
    totalParentsWithDupes: number;
    totalDuplicateSets: number;
    totalDuplicateVariations: number;
    totalFixable: number;
    totalUnfixable: number;
    totalSkusNotInFeed: number;
    totalNewTermsNeeded: number;
  };
  fixes: FixReport[];
}

interface ScriptOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  output: string;
  limit?: number;
  parentId?: number;
  verbose: boolean;
}

// ==================== ARGUMENT PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const opts: ScriptOptions = {
    mode: 'analyze',
    output: 'scripts/output/fix-report.json',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--analyze':
        opts.mode = 'analyze';
        break;
      case '--dry-run':
        opts.mode = 'dry-run';
        break;
      case '--apply':
        opts.mode = 'apply';
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--limit':
        opts.limit = parseInt(args[++i], 10);
        break;
      case '--parent':
        opts.parentId = parseInt(args[++i], 10);
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      // Skip flags handled by lib/db.ts
      case '--local':
      case '--remote':
        break;
      case '--db':
        i++; // skip next arg (db name)
        break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Fix Duplicate Product Variations
================================
Finds variations sharing the same attribute values, looks up their SKUs
in product feed files, and updates attributes to differentiate them.

Usage: bun scripts/fix-duplicate-variations.ts [mode] [options]

Modes:
  --analyze     Analyze and write JSON report (default)
  --dry-run     Show exact SQL that would be executed
  --apply       Execute fixes in a database transaction

Options:
  --local       Connect to local DB (via socket)
  --output <f>  JSON report path (default: scripts/output/fix-report.json)
  --limit <n>   Limit number of parent products to process
  --parent <id> Only process a specific parent product ID
  --verbose     Print extra debug info
  --help, -h    Show this help
`);
}

// ==================== FEED PARSING ====================

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';

const WILLIAMS_XML_FILES = [
  `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
];

const STC_CSV_FILE = `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`;

/**
 * Stream-parse a Williams Trading XML file using readline + regex.
 * Avoids loading 100MB+ files into memory.
 */
async function parseWilliamsXml(
  filePath: string,
  skuMap: Map<string, FeedProduct>,
  barcodeMap: Map<string, string>
): Promise<number> {
  if (!existsSync(filePath)) {
    console.log(`  [skip] File not found: ${filePath}`);
    return 0;
  }

  const fileSize = (await Bun.file(filePath).stat?.())
    ? `${(Bun.file(filePath).size / 1024 / 1024).toFixed(1)}MB`
    : '?MB';
  console.log(`  Parsing ${filePath.split('/').pop()} (${fileSize})...`);

  return new Promise<number>((resolve, reject) => {
    let count = 0;
    let inProduct = false;
    let currentProduct: Partial<FeedProduct> = {};
    let buffer = '';

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      buffer += line + '\n';

      if (line.includes('<product ') || line.trim() === '<product>') {
        inProduct = true;
        currentProduct = { source: 'williams' };
        buffer = line + '\n';
      }

      if (inProduct && line.includes('</product>')) {
        // Extract fields from the buffered product block
        const block = buffer;

        const sku = extractXmlField(block, 'sku');
        if (sku) {
          const barcode = extractXmlField(block, 'barcode');
          currentProduct.sku = sku;
          currentProduct.name = extractXmlCdata(block, 'name') || extractXmlField(block, 'name') || '';
          currentProduct.color = extractXmlField(block, 'color') || '';
          currentProduct.material = extractXmlField(block, 'material') || '';
          currentProduct.height = extractXmlField(block, 'height') || '';
          currentProduct.length = extractXmlField(block, 'length') || '';
          currentProduct.diameter = extractXmlField(block, 'diameter') || '';
          currentProduct.weight = extractXmlField(block, 'weight') || '';
          currentProduct.size = ''; // Williams doesn't have a dedicated size field
          currentProduct.description = extractXmlCdata(block, 'description') || '';

          // Only add if not already present (first file wins)
          if (!skuMap.has(sku)) {
            skuMap.set(sku, currentProduct as FeedProduct);
            count++;
          }

          // Build barcode → warehouse SKU mapping
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

/**
 * Parse the STC CSV feed using csv-parse (streaming).
 */
async function parseStcCsv(filePath: string, skuMap: Map<string, FeedProduct>, barcodeMap: Map<string, string>): Promise<number> {
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
      // STC uses Handle as a slug-like identifier; UPC is the barcode
      // The Handle column is like a slug; we need to match by UPC or handle
      // STC products in DB typically have the Handle as the SKU
      const handle = (row['Handle'] || '').trim();
      const upc = (row['UPC'] || '').trim();
      const name = (row['Product Name'] || '').trim();

      if (!handle && !upc) return;

      const product: FeedProduct = {
        sku: handle, // STC uses handle as SKU in WooCommerce
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

      // Index by both handle and UPC
      if (handle && !skuMap.has(handle)) {
        skuMap.set(handle, product);
        count++;
      }
      if (upc && !skuMap.has(upc)) {
        skuMap.set(upc, { ...product, sku: upc });
      }
      // STC: UPC → handle mapping
      if (upc && handle && !barcodeMap.has(upc)) {
        barcodeMap.set(upc, handle);
      }
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}

/** Maps barcode (UPC) → warehouse SKU for resolving DB _sku → feed lookup */
let _barcodeToSkuMap: Map<string, string> | null = null;

/**
 * Build the full SKU -> FeedProduct lookup map from all feeds.
 * Also builds a barcode → warehouse SKU mapping for resolving DB barcodes.
 */
async function buildSkuLookup(): Promise<Map<string, FeedProduct>> {
  console.log('\n--- Step 1: Building SKU lookup from product feeds ---');
  const skuMap = new Map<string, FeedProduct>();
  const barcodeMap = new Map<string, string>();

  for (const xmlFile of WILLIAMS_XML_FILES) {
    const count = await parseWilliamsXml(xmlFile, skuMap, barcodeMap);
    console.log(`    -> Added ${count.toLocaleString()} products`);
  }

  const stcCount = await parseStcCsv(STC_CSV_FILE, skuMap, barcodeMap);
  console.log(`    -> Added ${stcCount.toLocaleString()} STC products`);

  console.log(`  Total SKU lookup entries: ${skuMap.size.toLocaleString()}`);
  console.log(`  Total barcode→warehouseSku mappings: ${barcodeMap.size.toLocaleString()}`);
  _barcodeToSkuMap = barcodeMap;
  return skuMap;
}

// ==================== DATABASE QUERIES ====================

async function findAllDuplicateSets(db: Connection, opts: ScriptOptions): Promise<ParentDuplicates[]> {
  console.log('\n--- Step 2: Finding duplicate variation sets in database ---');

  // Get all variations with their parents
  let variationQuery = `
    SELECT v.ID as var_id, v.post_parent, v.post_title as var_title,
           v.post_name as var_slug, v.post_status as var_status,
           p.post_title as parent_title, p.post_name as parent_slug
    FROM wp_posts v
    JOIN wp_posts p ON p.ID = v.post_parent AND p.post_type = 'product'
    WHERE v.post_type = 'product_variation'
  `;
  const queryParams: (string | number)[] = [];

  if (opts.parentId) {
    variationQuery += ` AND v.post_parent = ?`;
    queryParams.push(opts.parentId);
  }

  variationQuery += ` ORDER BY v.post_parent, v.ID`;

  const [allVariations] = await db.query<RowDataPacket[]>(variationQuery, queryParams);
  console.log(`  Found ${allVariations.length.toLocaleString()} total variations`);

  if (allVariations.length === 0) return [];

  // Get all attribute_ meta for variations
  const [allAttrs] = await db.query<RowDataPacket[]>(
    `SELECT pm.post_id, pm.meta_key, pm.meta_value
     FROM wp_postmeta pm
     JOIN wp_posts v ON v.ID = pm.post_id AND v.post_type = 'product_variation'
     WHERE pm.meta_key LIKE 'attribute_%'
     ORDER BY pm.post_id, pm.meta_key`
  );
  console.log(`  Found ${allAttrs.length.toLocaleString()} attribute meta rows`);

  // Get SKUs and warehouse SKUs for all variations
  const [skuRows] = await db.query<RowDataPacket[]>(
    `SELECT pm.post_id, pm.meta_key, pm.meta_value
     FROM wp_postmeta pm
     JOIN wp_posts v ON v.ID = pm.post_id AND v.post_type = 'product_variation'
     WHERE pm.meta_key IN ('_sku', '_wt_sku') AND pm.meta_value != ''`
  );
  const skuByVariation = new Map<number, string>();
  const wtSkuByVariation = new Map<number, string>();
  for (const r of skuRows) {
    if (r.meta_key === '_sku') skuByVariation.set(r.post_id, r.meta_value);
    if (r.meta_key === '_wt_sku') wtSkuByVariation.set(r.post_id, r.meta_value);
  }
  console.log(`  Found ${skuByVariation.size.toLocaleString()} variation SKUs`);
  console.log(`  Found ${wtSkuByVariation.size.toLocaleString()} warehouse SKUs (_wt_sku)`);

  // Build attr map per variation
  const varAttrMap = new Map<number, Map<string, string>>();
  for (const row of allAttrs) {
    if (!varAttrMap.has(row.post_id)) {
      varAttrMap.set(row.post_id, new Map());
    }
    varAttrMap.get(row.post_id)!.set(row.meta_key, row.meta_value);
  }

  // Group by parent, then by attribute key
  const parentGroups = new Map<number, Map<string, number[]>>();
  const varInfoMap = new Map<number, RowDataPacket>();

  for (const v of allVariations) {
    varInfoMap.set(v.var_id, v);
    const attrs = varAttrMap.get(v.var_id) || new Map();
    const attrKey = buildAttrKey(attrs);

    if (!parentGroups.has(v.post_parent)) {
      parentGroups.set(v.post_parent, new Map());
    }
    const group = parentGroups.get(v.post_parent)!;
    if (!group.has(attrKey)) {
      group.set(attrKey, []);
    }
    group.get(attrKey)!.push(v.var_id);
  }

  // Filter to only parents with duplicates
  const results: ParentDuplicates[] = [];
  for (const [parentId, attrGroups] of parentGroups) {
    let dupes = [...attrGroups.entries()].filter(([, ids]) => ids.length > 1);
    if (dupes.length === 0) continue;

    // Filter out sets that are already uniquely differentiated by another attribute.
    // E.g., two variations sharing pa_size=2-oz but having different pa_style values
    // are NOT truly duplicates — they're already differentiated.
    dupes = dupes.filter(([attrKey, ids]) => {
      // Get ALL attribute keys present across these variations
      const allKeys = new Set<string>();
      for (const id of ids) {
        const attrs = varAttrMap.get(id);
        if (attrs) {
          for (const key of attrs.keys()) allKeys.add(key);
        }
      }

      // For each attribute key, check if it uniquely differentiates the set
      for (const key of allKeys) {
        // Skip the keys that form the shared attrKey (those are the duplicated ones)
        const sharedKeys = attrKey.split('|').map(pair => pair.split('=')[0]);
        if (sharedKeys.includes(key)) continue;

        // Collect values for this key across all variations in the set
        const values = new Map<string, number[]>();
        for (const id of ids) {
          const val = varAttrMap.get(id)?.get(key) || '';
          if (!values.has(val)) values.set(val, []);
          values.get(val)!.push(id);
        }

        // If all variations have unique values for this key → already differentiated
        if (values.size === ids.length && !values.has('')) {
          if (opts.verbose) {
            console.log(`    Skipping dupe set for parent ${parentId}: already differentiated by ${key} (${[...values.keys()].join(', ')})`);
          }
          return false; // Not a real duplicate
        }
      }
      return true; // Truly duplicated
    });

    if (dupes.length === 0) continue;

    const firstVar = varInfoMap.get(dupes[0][1][0])!;
    const dupeSets: DuplicateSet[] = dupes.map(([attrKey, ids]) => {
      const attrs = varAttrMap.get(ids[0]) || new Map();
      return {
        attrKey,
        attrPairs: [...attrs.entries()] as [string, string][],
        variationIds: ids,
      };
    });

    results.push({
      parentId,
      parentTitle: firstVar.parent_title,
      parentSlug: firstVar.parent_slug,
      productAttributes: {}, // Will be populated below
      duplicateSets: dupeSets,
    });
  }

  // Now get _product_attributes for affected parents
  if (results.length > 0) {
    const parentIds = results.map(r => r.parentId);
    const [attrMeta] = await db.query<RowDataPacket[]>(
      `SELECT post_id, meta_value
       FROM wp_postmeta
       WHERE post_id IN (${parentIds.join(',')})
         AND meta_key = '_product_attributes'`
    );
    for (const row of attrMeta) {
      const parent = results.find(r => r.parentId === row.post_id);
      if (parent && row.meta_value) {
        parent.productAttributes = deserializePhpArray(row.meta_value);
      }
    }
  }

  // Attach SKU info to each variation for later lookup
  for (const r of results) {
    for (const ds of r.duplicateSets) {
      (ds as any)._skus = ds.variationIds.map(id => skuByVariation.get(id) || '');
    }
  }

  // Sort by number of duplicate sets descending
  results.sort((a, b) => b.duplicateSets.length - a.duplicateSets.length);

  if (opts.limit) {
    results.length = Math.min(results.length, opts.limit);
  }

  console.log(`  Parents with duplicate variations: ${results.length}`);
  const totalDupeSets = results.reduce((s, r) => s + r.duplicateSets.length, 0);
  const totalDupeVars = results.reduce(
    (s, r) => s + r.duplicateSets.reduce((ss, ds) => ss + ds.variationIds.length, 0),
    0
  );
  console.log(`  Total duplicate sets: ${totalDupeSets}`);
  console.log(`  Total variations in duplicate sets: ${totalDupeVars}`);

  // Store sku maps on results for later use
  (results as any)._skuByVariation = skuByVariation;
  (results as any)._wtSkuByVariation = wtSkuByVariation;

  return results;
}

function buildAttrKey(attrs: Map<string, string>): string {
  const sorted = [...attrs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([k, v]) => `${k}=${v}`).join('|');
}

// ==================== PHP SERIALIZATION ====================

/**
 * Minimal PHP serialized array deserializer.
 * Handles the common WooCommerce _product_attributes format.
 */
function deserializePhpArray(str: string): Record<string, ProductAttribute> {
  try {
    const result: Record<string, any> = {};
    // Match top-level array items
    // Format: a:N:{s:key;a:M:{...}}
    if (!str.startsWith('a:')) return {};

    let pos = 0;

    function readString(): string {
      // s:N:"...";
      if (str[pos] !== 's') throw new Error(`Expected 's' at ${pos}, got '${str[pos]}'`);
      pos++; // s
      pos++; // :
      let lenStr = '';
      while (str[pos] !== ':') { lenStr += str[pos]; pos++; }
      pos++; // :
      pos++; // "
      const len = parseInt(lenStr, 10);
      const val = str.substring(pos, pos + len);
      pos += len;
      pos++; // "
      pos++; // ;
      return val;
    }

    function readInt(): number {
      // i:N;
      pos++; // i
      pos++; // :
      let numStr = '';
      while (str[pos] !== ';') { numStr += str[pos]; pos++; }
      pos++; // ;
      return parseInt(numStr, 10);
    }

    function readValue(): any {
      if (str[pos] === 's') return readString();
      if (str[pos] === 'i') return readInt();
      if (str[pos] === 'a') return readArray();
      if (str[pos] === 'b') {
        pos++; // b
        pos++; // :
        const val = str[pos] === '1';
        pos++; // 0 or 1
        pos++; // ;
        return val;
      }
      if (str[pos] === 'N') {
        pos++; // N
        pos++; // ;
        return null;
      }
      throw new Error(`Unknown type '${str[pos]}' at pos ${pos}`);
    }

    function readArray(): Record<string, any> {
      // a:N:{...}
      pos++; // a
      pos++; // :
      let countStr = '';
      while (str[pos] !== ':') { countStr += str[pos]; pos++; }
      pos++; // :
      pos++; // {
      const count = parseInt(countStr, 10);
      const obj: Record<string, any> = {};
      for (let i = 0; i < count; i++) {
        const key = str[pos] === 'i' ? String(readInt()) : readString();
        // After readInt for key, the ; is already consumed, but for array keys
        // PHP uses i:N; format too
        const value = readValue();
        obj[key] = value;
      }
      pos++; // }
      return obj;
    }

    return readArray() as Record<string, ProductAttribute>;
  } catch {
    return {};
  }
}

/**
 * Serialize a JS object back to PHP serialized format for _product_attributes.
 */
function serializePhpArray(obj: Record<string, any>): string {
  function ser(val: any): string {
    if (val === null || val === undefined) return 'N;';
    if (typeof val === 'boolean') return `b:${val ? 1 : 0};`;
    if (typeof val === 'number' && Number.isInteger(val)) return `i:${val};`;
    if (typeof val === 'string') return `s:${val.length}:"${val}";`;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const entries = Object.entries(val);
      let inner = '';
      for (const [k, v] of entries) {
        // Key
        if (/^\d+$/.test(k)) {
          inner += `i:${parseInt(k, 10)};`;
        } else {
          inner += `s:${k.length}:"${k}";`;
        }
        inner += ser(v);
      }
      return `a:${entries.length}:{${inner}}`;
    }
    // Fallback: treat numbers as strings
    const s = String(val);
    return `s:${s.length}:"${s}";`;
  }
  return ser(obj);
}

// ==================== DIFFERENTIATOR EXTRACTION ====================

/**
 * Given feed names for variations in a duplicate set, find what differs.
 * Returns a map of variationId -> suggested attribute value.
 */
// ==================== DIFFERENTIATOR CLASSIFICATION ====================

// Comprehensive keyword lists for classification (borrowed from xml-parser.ts patterns)
const SIZE_WORDS = new Set([
  'small', 'medium', 'large', 'mini', 'petite', 'regular', 'jumbo', 'giant', 'king',
  'xs', 'sm', 'md', 'med', 'lg', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl',
  'x-small', 'x-large', 'xx-large', 'xxx-large',
  's/m', 'm/l', 'l/xl', 'xl/xxl', 'o/s', 'os', 'one size', 'queen', 'q/s',
  '1x', '2x', '3x', '4x', '1x/2x', '3x/4x',
  'jr', 'junior', 'senior',
]);
const SIZE_UNIT_RE = /\b\d+(\.\d+)?\s*(oz|ounces?|fl\.?\s*oz|ml|milliliters?|l|liters?|g|grams?|mg|lb|lbs|pounds?|inches?|in\.?|"|″|mm|cm|centimeters?|ft|feet|pc|pk|pack|count|ct)\b/i;
const SIZE_DIMENSION_RE = /\b\d+(\.\d+)?\s*x\s*\d+/i;

const COLOR_WORDS = new Set([
  'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear', 'silver', 'gold',
  'bronze', 'copper', 'grey', 'gray', 'brown', 'yellow', 'teal', 'navy', 'nude', 'tan',
  'beige', 'ivory', 'orange', 'wine', 'burgundy', 'charcoal', 'coral', 'fuchsia', 'indigo',
  'magenta', 'maroon', 'olive', 'plum', 'salmon', 'turquoise', 'violet', 'rose', 'flesh',
  'midnight', 'pearl', 'matte', 'neon', 'chrome', 'rainbow',
  // Multi-word colors
  'neon green', 'neon pink', 'neon blue', 'neon purple', 'neon red',
  'hot pink', 'light blue', 'light pink', 'dark brown', 'rose gold',
  'midnight black', 'pearl white', 'matte black',
  // Abbreviations
  'blk', 'wht', 'pnk', 'prp', 'blu', 'grn', 'gld', 'slv', 'brn', 'ylw',
]);

const FORMULA_WORDS = new Set([
  'silicone', 'water', 'h2o', 'water-based', 'oil', 'hybrid', 'warming', 'cooling',
  'tingling', 'original', 'classic', 'natural', 'organic', 'gel', 'cream', 'foam',
  'liquid', 'spray', 'mousse',
]);

const FLAVOR_WORDS = new Set([
  'mango', 'cherry', 'strawberry', 'vanilla', 'chocolate', 'mint', 'grape', 'lemon',
  'lime', 'banana', 'raspberry', 'blueberry', 'peach', 'apple', 'watermelon', 'coconut',
  'lavender', 'peppermint', 'spearmint', 'cinnamon', 'ginger', 'honey', 'caramel',
  'mocha', 'coffee', 'melon', 'berry', 'tropical', 'citrus', 'floral',
  'pina colada', 'cotton candy', 'bubble gum', 'blue raspberry', 'green apple',
  'passion fruit', 'strawberry banana',
]);

const FEATURE_WORDS = new Set([
  'vibrating', 'rechargeable', 'suction', 'suction cup', 'with balls', 'w/balls',
  'dong', 'dildo', 'plug', 'strap-on', 'harness', 'remote', 'wireless',
  'heated', 'rotating', 'thrusting', 'inflatable',
]);

/**
 * Classify what type of differentiator a text value represents.
 */
function classifyDifferentiator(text: string): ClassifiedDifferentiator {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/[\s\-\/]+/).filter(Boolean);

  // Check for size units first (most reliable signal)
  if (SIZE_UNIT_RE.test(lower) || SIZE_DIMENSION_RE.test(lower)) {
    return { type: 'size', value: text.trim(), fullText: text };
  }

  // Check if ALL words are size words
  if (words.length > 0 && words.every(w => SIZE_WORDS.has(w))) {
    return { type: 'size', value: text.trim(), fullText: text };
  }

  // Check for pure color
  if (COLOR_WORDS.has(lower) || (words.length <= 2 && words.every(w => COLOR_WORDS.has(w)))) {
    return { type: 'color', value: text.trim(), fullText: text };
  }

  // Check for formula/type
  if (FORMULA_WORDS.has(lower) || words.some(w => FORMULA_WORDS.has(w))) {
    // Make sure it's not also a color
    if (!words.some(w => COLOR_WORDS.has(w))) {
      return { type: 'formula', value: text.trim(), fullText: text };
    }
  }

  // Check for flavor
  if (FLAVOR_WORDS.has(lower) || words.some(w => FLAVOR_WORDS.has(w))) {
    return { type: 'variant', value: text.trim(), fullText: text };
  }

  // Mixed content: check if it contains size + something else
  const hasSize = SIZE_UNIT_RE.test(lower) || words.some(w => SIZE_WORDS.has(w));
  const hasColor = words.some(w => COLOR_WORDS.has(w));
  const hasFeature = words.some(w => FEATURE_WORDS.has(w));
  // Check for bare numbers (e.g., "8" in "Whoppers 8 Vibrating Dong")
  const hasBareNumber = /\b\d+(\.\d+)?\b/.test(lower);

  if (hasSize && !hasColor && !hasFeature) {
    return { type: 'size', value: text.trim(), fullText: text };
  }
  if (hasColor && !hasSize && !hasBareNumber) {
    return { type: 'color', value: text.trim(), fullText: text };
  }
  // If contains a bare number but no recognized size unit, still treat as size
  // (common for product names like "Whopper 8 Vibrating Dong" where 8 = 8 inches)
  if (hasBareNumber && !hasColor) {
    return { type: 'size', value: text.trim(), fullText: text };
  }

  // Default: treat as variant
  return { type: 'variant', value: text.trim(), fullText: text };
}

/**
 * Extract the size portion from a mixed text (e.g., "Small - Clear" -> "Small")
 */
function extractSizeFromText(text: string): string | null {
  const lower = text.toLowerCase();

  // Match unit-based sizes: "2 oz", "7 inches", "8ml"
  const unitMatch = lower.match(/\d+(\.\d+)?\s*(oz|ounces?|fl\.?\s*oz|ml|milliliters?|l|liters?|g|grams?|inches?|in\.?|"|″|mm|cm|ft|pc|pk|pack|count|ct)\b/i);
  if (unitMatch) return unitMatch[0].trim();

  // Match size words
  const words = text.split(/[\s\-\/,]+/);
  for (const w of words) {
    if (SIZE_WORDS.has(w.toLowerCase())) return w;
  }

  // Match bare numbers (e.g., "8" in "Whoppers 8 Vibrating Dong")
  // Only if surrounded by non-numeric text
  const bareNum = lower.match(/\b(\d+(\.\d+)?)\b/);
  if (bareNum) return bareNum[0].trim();

  return null;
}

/**
 * Extract the color portion from a mixed text (e.g., "Small - Clear" -> "Clear")
 */
function extractColorFromText(text: string): string | null {
  const words = text.split(/[\s\-\/,]+/);
  const colorParts: string[] = [];
  for (const w of words) {
    if (COLOR_WORDS.has(w.toLowerCase())) colorParts.push(w);
  }
  return colorParts.length > 0 ? colorParts.join(' ') : null;
}

/**
 * Clean up a classified differentiator value to extract just the relevant portion.
 * E.g., for type 'size': "All American Whopper 7 inches Vibrating Dong" -> "7 inches"
 * E.g., for type 'color': "5 Dildo w/Suction Cup - Flesh" -> "Flesh"
 */
function cleanClassifiedValue(classified: ClassifiedDifferentiator): ClassifiedDifferentiator {
  const { type, value, fullText } = classified;

  if (type === 'size') {
    // Try to extract just the size portion
    const sizeExtract = extractSizeFromText(value);
    if (sizeExtract && sizeExtract.length < value.length * 0.8) {
      return { type, value: sizeExtract, fullText };
    }
  }

  if (type === 'color') {
    // Try to extract just the color portion
    const colorExtract = extractColorFromText(value);
    if (colorExtract && colorExtract.length < value.length * 0.8) {
      return { type, value: colorExtract, fullText };
    }
  }

  if (type === 'formula') {
    // Extract just the formula-related words
    const words = value.split(/[\s\-\/,]+/);
    const formulaParts = words.filter(w => FORMULA_WORDS.has(w.toLowerCase()));
    if (formulaParts.length > 0 && formulaParts.join(' ').length < value.length * 0.8) {
      return { type, value: formulaParts.join(' '), fullText };
    }
  }

  return classified;
}

// ==================== DIFFERENTIATOR EXTRACTION ====================

function extractDifferentiators(
  variationSkus: Array<{ varId: number; sku: string; feedProduct: FeedProduct | undefined }>,
  opts: ScriptOptions,
  parentTitle?: string
): Map<number, ClassifiedDifferentiator> {
  const result = new Map<number, ClassifiedDifferentiator>();
  const withFeed = variationSkus.filter(v => v.feedProduct);

  if (withFeed.length < 2) return result;

  // Strategy 1: Use structured feed fields (color, size) if they uniquely differentiate
  const feedColors = withFeed.map(v => v.feedProduct!.color?.trim()).filter(Boolean);
  const feedSizes = withFeed.map(v => v.feedProduct!.size?.trim()).filter(Boolean);

  // If feed has unique colors for all variations, use those
  if (feedColors.length === withFeed.length && new Set(feedColors).size === withFeed.length) {
    for (const v of withFeed) {
      result.set(v.varId, { type: 'color', value: toTitleCase(v.feedProduct!.color.trim()), fullText: v.feedProduct!.color.trim() });
    }
    return result;
  }

  // If feed has unique sizes for all variations, use those
  if (feedSizes.length === withFeed.length && new Set(feedSizes).size === withFeed.length) {
    for (const v of withFeed) {
      result.set(v.varId, { type: 'size', value: v.feedProduct!.size.trim(), fullText: v.feedProduct!.size.trim() });
    }
    return result;
  }

  // Strategy 2: Extract differentiating part from feed names
  const names = withFeed.map(v => v.feedProduct!.name.toUpperCase().trim());
  const commonPrefix = findCommonPrefix(names);
  const commonSuffix = findCommonSuffix(names);

  // Also compute normalized parent title for stripping
  const normalizedParentTitle = parentTitle ? parentTitle.toUpperCase().trim() : '';

  if (opts.verbose) {
    console.log(`      Names: ${names.join(' | ')}`);
    console.log(`      Common prefix: "${commonPrefix}"`);
    console.log(`      Common suffix: "${commonSuffix}"`);
    if (normalizedParentTitle) {
      console.log(`      Parent title: "${normalizedParentTitle}"`);
    }
  }

  for (const v of withFeed) {
    const name = v.feedProduct!.name.toUpperCase().trim();
    let unique = name;

    // Strip whichever is longer: common prefix or parent title
    const prefixToStrip = normalizedParentTitle.length > commonPrefix.length
      ? normalizedParentTitle
      : commonPrefix;

    if (prefixToStrip.length > 0 && unique.startsWith(prefixToStrip)) {
      unique = unique.substring(prefixToStrip.length);
    } else if (commonPrefix.length > 0 && unique.startsWith(commonPrefix)) {
      unique = unique.substring(commonPrefix.length);
    } else if (normalizedParentTitle.length > 0 && unique.startsWith(normalizedParentTitle)) {
      unique = unique.substring(normalizedParentTitle.length);
    }

    if (commonSuffix.length > 0 && unique.endsWith(commonSuffix)) {
      unique = unique.substring(0, unique.length - commonSuffix.length);
    }
    unique = unique.replace(/^[\s\-\/]+|[\s\-\/]+$/g, '').trim();

    // Strip filler words
    const words = unique.split(/\s+/);
    const filtered = words.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
    unique = filtered.join(' ').trim();

    if (!unique) {
      // Fallback to structured fields
      if (v.feedProduct!.color) unique = v.feedProduct!.color;
      else if (v.feedProduct!.size) unique = v.feedProduct!.size;
      else unique = v.sku;
    }

    if (unique) {
      const classified = cleanClassifiedValue(classifyDifferentiator(unique));
      // Apply title case to the value
      classified.value = toTitleCase(classified.value);
      result.set(v.varId, classified);
    }
  }

  // Verify uniqueness of the values
  const values = [...result.values()].map(d => d.value.toLowerCase());
  if (new Set(values).size < values.length) {
    // Not unique enough. Try enriching with feed fields.
    // But first, try using the FULL (uncleaned) name diff since cleaning may have removed discriminating info
    const fullValues = new Map<number, ClassifiedDifferentiator>();
    for (const v of withFeed) {
      const name = v.feedProduct!.name.toUpperCase().trim();
      let unique = name;
      if (commonPrefix.length > 0) unique = unique.substring(commonPrefix.length);
      if (commonSuffix.length > 0 && unique.endsWith(commonSuffix)) {
        unique = unique.substring(0, unique.length - commonSuffix.length);
      }
      unique = unique.replace(/^[\s\-\/]+|[\s\-\/]+$/g, '').trim();
      if (unique) {
        const classified = classifyDifferentiator(unique);
        fullValues.set(v.varId, classified);
      }
    }
    const fullVals = [...fullValues.values()].map(d => d.value.toLowerCase());
    if (new Set(fullVals).size === fullVals.length && fullValues.size === withFeed.length) {
      return fullValues; // Full uncleaned values are unique
    }
    return enrichDifferentiators(variationSkus, result, opts);
  }

  return result;
}

/**
 * When name-based differentiators aren't unique, try feed metadata fields.
 */
function enrichDifferentiators(
  variationSkus: Array<{ varId: number; sku: string; feedProduct: FeedProduct | undefined }>,
  existing: Map<number, ClassifiedDifferentiator>,
  opts: ScriptOptions
): Map<number, ClassifiedDifferentiator> {
  const withFeed = variationSkus.filter(v => v.feedProduct);
  const result = new Map<number, ClassifiedDifferentiator>();

  // Check if materials uniquely differentiate
  const materials = withFeed.map(v => v.feedProduct!.material?.trim()).filter(Boolean);
  if (materials.length === withFeed.length && new Set(materials).size === withFeed.length) {
    for (const v of withFeed) {
      result.set(v.varId, { type: 'formula', value: v.feedProduct!.material.trim(), fullText: v.feedProduct!.material.trim() });
    }
    return result;
  }

  // Combine name diff + color/size for uniqueness
  for (const v of withFeed) {
    const ex = existing.get(v.varId);
    let label = ex?.value || '';
    const fp = v.feedProduct!;
    if (fp.color && !label.toLowerCase().includes(fp.color.toLowerCase())) {
      label = label ? `${label} ${fp.color}` : fp.color;
    }
    if (fp.size && !label.toLowerCase().includes(fp.size.toLowerCase())) {
      label = label ? `${label} ${fp.size}` : fp.size;
    }
    if (!label) label = v.sku;
    const classified = classifyDifferentiator(label.trim());
    result.set(v.varId, classified);
  }

  // If still not unique, append sku fragment
  const vals = [...result.values()].map(d => d.value.toLowerCase());
  if (new Set(vals).size < vals.length) {
    for (const v of withFeed) {
      const cur = result.get(v.varId);
      const val = cur ? `${cur.value} (${v.sku})` : v.sku;
      result.set(v.varId, { type: cur?.type || 'variant', value: val.trim(), fullText: val.trim() });
    }
  }

  return result;
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.length - 1);
      if (prefix.length === 0) return '';
    }
  }
  const lastSpace = prefix.lastIndexOf(' ');
  return lastSpace > 0 ? prefix.substring(0, lastSpace + 1) : prefix;
}

function findCommonSuffix(strings: string[]): string {
  const reversed = strings.map(s => s.split('').reverse().join(''));
  const prefix = findCommonPrefixRaw(reversed);
  return prefix.split('').reverse().join('');
}

function findCommonPrefixRaw(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.length - 1);
      if (prefix.length === 0) return '';
    }
  }
  return prefix;
}

/** Convert a string to Title Case, preserving lowercase for units like oz, ml */
function toTitleCase(str: string): string {
  const LOWERCASE_UNITS = new Set([
    'oz', 'ml', 'mg', 'g', 'kg', 'lb', 'lbs', 'in', 'mm', 'cm', 'ft',
    'fl', 'ct', 'pk', 'pc', 'w', 'x',
  ]);
  return str
    .toLowerCase()
    .split(/(\s+|-)/g)
    .map((part, i) => {
      if (/^\s+$/.test(part) || part === '-') return part;
      if (LOWERCASE_UNITS.has(part)) return part;
      // Preserve measurements like "2oz" or "7in"
      if (/^\d+(\.\d+)?\s*(oz|ml|mg|in|mm|cm|ft|ct|pk|pc)$/i.test(part)) {
        return part.toLowerCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/** Filler words to strip from variant names */
const FILLER_WORDS = new Set(['pk', 'pkg', 'pack', 'pck']);

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

// ==================== TAXONOMY ROUTING ====================

/** Map differentiator type to the ideal taxonomy */
const TYPE_TO_TAXONOMY: Record<DifferentiatorType, { taxonomy: string; metaKey: string; attrName: string }> = {
  size:    { taxonomy: 'pa_size',    metaKey: 'attribute_pa_size',    attrName: 'Size' },
  color:   { taxonomy: 'pa_color',   metaKey: 'attribute_pa_color',   attrName: 'Color' },
  formula: { taxonomy: 'pa_variant', metaKey: 'attribute_pa_variant', attrName: 'Variant' },
  variant: { taxonomy: 'pa_variant', metaKey: 'attribute_pa_variant', attrName: 'Variant' },
  unknown: { taxonomy: 'pa_variant', metaKey: 'attribute_pa_variant', attrName: 'Variant' },
};

/**
 * Determine which attribute taxonomy to use for a fix.
 * Now considers the CLASSIFIED type of the differentiator rather than
 * blindly using the first existing variation attribute.
 *
 * Returns the target taxonomy info + whether a new attribute needs to be added to the parent.
 */
function determineAttributeTaxonomy(
  parentAttrs: Record<string, ProductAttribute>,
  differentiators: Map<number, ClassifiedDifferentiator>,
  currentAttrKey: string // The shared attribute meta_key (e.g., "attribute_pa_color")
): { metaKey: string; taxonomy: string; attrName: string; isNewAttribute: boolean } | null {
  // Determine the dominant type of the differentiators
  const typeCounts = new Map<DifferentiatorType, number>();
  for (const d of differentiators.values()) {
    typeCounts.set(d.type, (typeCounts.get(d.type) || 0) + 1);
  }
  // Pick the most common type
  let dominantType: DifferentiatorType = 'variant';
  let maxCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > maxCount) { dominantType = type; maxCount = count; }
  }

  const idealTarget = TYPE_TO_TAXONOMY[dominantType];

  // Check if the current shared attribute IS the ideal taxonomy
  // e.g., duplicates share pa_color and differentiator is color -> just update the value in pa_color
  if (currentAttrKey === idealTarget.metaKey) {
    return { ...idealTarget, isNewAttribute: false };
  }

  // Check if the ideal taxonomy already exists as a variation attribute on this parent
  const existingAttr = Object.entries(parentAttrs).find(([key]) => {
    const tax = key.startsWith('pa_') ? key : `pa_${key}`;
    return `attribute_${tax}` === idealTarget.metaKey;
  });

  if (existingAttr) {
    // The taxonomy exists on the parent but the variations share a different attribute
    // We need to ADD or UPDATE this attribute on the variations
    return { ...idealTarget, isNewAttribute: true };
  }

  // The ideal taxonomy doesn't exist on parent at all - we need to create it
  return { ...idealTarget, isNewAttribute: true };
}

// ==================== FIX PLANNING ====================

async function planFixes(
  db: Connection,
  parentDupes: ParentDuplicates[],
  skuMap: Map<string, FeedProduct>,
  opts: ScriptOptions
): Promise<AnalysisReport> {
  console.log('\n--- Step 3: Planning fixes ---');

  const skuByVariation: Map<number, string> = (parentDupes as any)._skuByVariation || new Map();
  const wtSkuByVariation: Map<number, string> = (parentDupes as any)._wtSkuByVariation || new Map();

  // Get existing terms for all pa_ taxonomies we might need
  const [existingTerms] = await db.query<RowDataPacket[]>(
    `SELECT t.term_id, t.name, t.slug, tt.taxonomy
     FROM wp_terms t
     JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
     WHERE tt.taxonomy LIKE 'pa_%'`
  );
  const termLookup = new Map<string, { termId: number; name: string; slug: string }>();
  for (const t of existingTerms) {
    termLookup.set(`${t.taxonomy}:${t.slug}`, { termId: t.term_id, name: t.name, slug: t.slug });
  }
  console.log(`  Loaded ${existingTerms.length.toLocaleString()} existing attribute terms`);

  const report: AnalysisReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalParentsWithDupes: parentDupes.length,
      totalDuplicateSets: 0,
      totalDuplicateVariations: 0,
      totalFixable: 0,
      totalUnfixable: 0,
      totalSkusNotInFeed: 0,
      totalNewTermsNeeded: 0,
    },
    fixes: [],
  };

  let processed = 0;
  for (const parent of parentDupes) {
    processed++;
    if (processed % 100 === 0) {
      console.log(`  Processing parent ${processed}/${parentDupes.length}...`);
    }

    const fixReport: FixReport = {
      parentId: parent.parentId,
      parentTitle: parent.parentTitle,
      parentSlug: parent.parentSlug,
      duplicateSets: [],
    };

    for (const ds of parent.duplicateSets) {
      report.summary.totalDuplicateSets++;
      report.summary.totalDuplicateVariations += ds.variationIds.length;

      const setReport: FixReport['duplicateSets'][0] = {
        attrKey: ds.attrKey,
        variationCount: ds.variationIds.length,
        fixes: [],
        unfixable: [],
      };

      // Look up each variation's feed product.
      // Priority: _wt_sku (warehouse SKU) → direct _sku lookup → barcode resolution fallback
      const variationSkus: Array<{
        varId: number;
        sku: string;
        feedProduct: FeedProduct | undefined;
      }> = ds.variationIds.map(varId => {
        const sku = skuByVariation.get(varId) || '';
        const wtSku = wtSkuByVariation.get(varId) || '';

        // Try warehouse SKU first (most reliable since backfill)
        let feedProduct = wtSku ? skuMap.get(wtSku) : undefined;

        // Fall back to direct _sku lookup
        if (!feedProduct && sku) {
          feedProduct = skuMap.get(sku);
        }

        // Last resort: barcode → warehouse SKU resolution
        if (!feedProduct && sku && _barcodeToSkuMap) {
          const resolved = _barcodeToSkuMap.get(sku);
          if (resolved) feedProduct = skuMap.get(resolved);
        }

        return { varId, sku, feedProduct };
      });

      // Count how many aren't in the feed
      const notInFeed = variationSkus.filter(v => !v.feedProduct);
      report.summary.totalSkusNotInFeed += notInFeed.length;

      // Try to extract differentiators (now classified by type)
      const differentiators = extractDifferentiators(variationSkus, opts, parent.parentTitle);

      if (differentiators.size < 2) {
        // Can't differentiate - mark all as unfixable
        for (const v of variationSkus) {
          setReport.unfixable.push({
            variationId: v.varId,
            sku: v.sku,
            reason: v.feedProduct
              ? 'Could not determine differentiating attribute from feed data'
              : v.sku
                ? `SKU "${v.sku}" not found in any product feed`
                : 'Variation has no SKU',
          });
          report.summary.totalUnfixable++;
        }
      } else {
        // Determine which taxonomy to route the fix to, based on classified type
        const currentAttrKey = ds.attrPairs.length > 0 ? ds.attrPairs[0][0] : '';
        const attrInfo = determineAttributeTaxonomy(
          parent.productAttributes,
          differentiators,
          currentAttrKey
        );

        if (!attrInfo) {
          for (const v of variationSkus) {
            setReport.unfixable.push({
              variationId: v.varId,
              sku: v.sku,
              reason: 'Could not determine target attribute taxonomy',
            });
            report.summary.totalUnfixable++;
          }
        } else {
          // Track if parent needs _product_attributes update
          const parentNeedsUpdate = attrInfo.isNewAttribute;

          // Build fix actions
          for (const v of variationSkus) {
            const classified = differentiators.get(v.varId);
            if (!classified) {
              setReport.unfixable.push({
                variationId: v.varId,
                sku: v.sku,
                reason: v.feedProduct
                  ? 'Could not extract unique differentiator'
                  : v.sku
                    ? `SKU "${v.sku}" not found in any product feed`
                    : 'Variation has no SKU',
              });
              report.summary.totalUnfixable++;
              continue;
            }

            const slug = toSlug(classified.value);
            const termExists = termLookup.has(`${attrInfo.taxonomy}:${slug}`);
            if (!termExists) {
              report.summary.totalNewTermsNeeded++;
            }

            // Get current attribute value for the target key
            const currentAttrValue = ds.attrPairs.find(
              ([k]) => k === attrInfo.metaKey
            )?.[1] || '';

            const fix: FixAction = {
              variationId: v.varId,
              sku: v.sku,
              feedName: v.feedProduct?.name || '',
              oldAttrValue: currentAttrValue,
              newAttrValue: classified.value,
              newAttrSlug: slug,
              attrMetaKey: attrInfo.metaKey,
              attrTaxonomy: attrInfo.taxonomy,
              termNeedsCreation: !termExists,
              isNewAttribute: attrInfo.isNewAttribute,
              parentNeedsAttrUpdate: parentNeedsUpdate,
            };

            setReport.fixes.push(fix);
            report.summary.totalFixable++;
          }
        }
      }

      fixReport.duplicateSets.push(setReport);
    }

    report.fixes.push(fixReport);
  }

  return report;
}

// ==================== SQL GENERATION & EXECUTION ====================

function generateSql(report: AnalysisReport): string[] {
  const statements: string[] = [];

  for (const fix of report.fixes) {
    for (const ds of fix.duplicateSets) {
      for (const action of ds.fixes) {
        // Create term if needed
        if (action.termNeedsCreation) {
          statements.push(
            `-- Create term "${action.newAttrValue}" in ${action.attrTaxonomy}`
          );
          statements.push(
            `INSERT IGNORE INTO wp_terms (name, slug) VALUES (${esc(action.newAttrValue)}, ${esc(action.newAttrSlug)});`
          );
          statements.push(
            `INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description, count) ` +
            `SELECT term_id, ${esc(action.attrTaxonomy)}, '', 0 FROM wp_terms WHERE slug = ${esc(action.newAttrSlug)};`
          );
        }

        // Update variation attribute
        statements.push(
          `-- Fix variation ${action.variationId} (SKU: ${action.sku}): ` +
          `"${action.oldAttrValue}" -> "${action.newAttrSlug}"`
        );
        statements.push(
          `UPDATE wp_postmeta SET meta_value = ${esc(action.newAttrSlug)} ` +
          `WHERE post_id = ${action.variationId} AND meta_key = ${esc(action.attrMetaKey)};`
        );
      }
    }
  }

  return statements;
}

function esc(val: string): string {
  return `'${val.replace(/'/g, "\\'")}'`;
}

async function applyFixes(db: Connection, report: AnalysisReport, opts: ScriptOptions): Promise<void> {
  console.log('\n--- Applying fixes in transaction ---');

  await db.beginTransaction();

  try {
    let termCreations = 0;
    let attrUpdates = 0;
    let attrInserts = 0;
    let parentAttrUpdates = 0;
    let errors = 0;

    // Track which parents need _product_attributes updates
    const parentsNeedingUpdate = new Set<number>();

    for (const fix of report.fixes) {
      for (const ds of fix.duplicateSets) {
        for (const action of ds.fixes) {
          try {
            // Create term if needed
            if (action.termNeedsCreation) {
              const [existing] = await db.query<RowDataPacket[]>(
                `SELECT t.term_id FROM wp_terms t
                 JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
                 WHERE t.slug = ? AND tt.taxonomy = ?`,
                [action.newAttrSlug, action.attrTaxonomy]
              );

              if (existing.length === 0) {
                await db.query(
                  `INSERT IGNORE INTO wp_terms (name, slug) VALUES (?, ?)`,
                  [action.newAttrValue, action.newAttrSlug]
                );

                const [termRow] = await db.query<RowDataPacket[]>(
                  `SELECT term_id FROM wp_terms WHERE slug = ?`,
                  [action.newAttrSlug]
                );

                if (termRow.length > 0) {
                  await db.query(
                    `INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description, count)
                     VALUES (?, ?, '', 0)`,
                    [termRow[0].term_id, action.attrTaxonomy]
                  );
                  termCreations++;
                }
              }
            }

            if (action.isNewAttribute) {
              // This is a NEW attribute dimension - INSERT (don't update existing)
              // First check if it already exists (idempotent)
              const [existingMeta] = await db.query<RowDataPacket[]>(
                `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
                [action.variationId, action.attrMetaKey]
              );

              if (existingMeta.length > 0) {
                // Already exists, update it
                await db.query(
                  `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?`,
                  [action.newAttrSlug, action.variationId, action.attrMetaKey]
                );
              } else {
                await db.query(
                  `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
                  [action.variationId, action.attrMetaKey, action.newAttrSlug]
                );
              }
              attrInserts++;

              if (action.parentNeedsAttrUpdate) {
                parentsNeedingUpdate.add(fix.parentId);
              }
            } else {
              // Update existing attribute value
              const [updateResult] = await db.query<any>(
                `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?`,
                [action.newAttrSlug, action.variationId, action.attrMetaKey]
              );

              if (updateResult.affectedRows > 0) {
                attrUpdates++;
              } else {
                // Meta row doesn't exist - insert it
                await db.query(
                  `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
                  [action.variationId, action.attrMetaKey, action.newAttrSlug]
                );
                attrInserts++;
              }
            }
          } catch (err: any) {
            errors++;
            console.error(
              `  ERROR fixing variation ${action.variationId}: ${err.message}`
            );
          }
        }
      }
    }

    // Update parent _product_attributes for parents that got new attribute dimensions
    for (const parentId of parentsNeedingUpdate) {
      try {
        // Find what new taxonomies were added for this parent's variations
        const newTaxonomies = new Set<string>();
        const parentFix = report.fixes.find(f => f.parentId === parentId);
        if (!parentFix) continue;

        for (const ds of parentFix.duplicateSets) {
          for (const action of ds.fixes) {
            if (action.isNewAttribute) {
              newTaxonomies.add(action.attrTaxonomy);
            }
          }
        }

        if (newTaxonomies.size === 0) continue;

        // Read current _product_attributes
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
          [parentId]
        );

        if (rows.length > 0) {
          let attrs: Record<string, any>;
          try {
            attrs = deserializePhpArray(rows[0].meta_value);
          } catch {
            console.warn(`  WARNING: Could not parse _product_attributes for parent ${parentId}`);
            continue;
          }

          // Add new attribute entries
          for (const tax of newTaxonomies) {
            if (!attrs[tax]) {
              const attrName = tax === 'pa_size' ? 'Size' :
                               tax === 'pa_color' ? 'Color' :
                               tax === 'pa_variant' ? 'Variant' :
                               tax === 'pa_flavor' ? 'Flavor' :
                               tax === 'pa_style' ? 'Style' : tax.replace('pa_', '');
              attrs[tax] = {
                name: attrName,
                value: '',
                position: Object.keys(attrs).length,
                is_visible: 1,
                is_variation: 1,
                is_taxonomy: 1,
              };
            }
          }

          // Write back serialized
          const serialized = serializePhpArray(attrs);
          await db.query(
            `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
            [serialized, parentId]
          );
          parentAttrUpdates++;
        }
      } catch (err: any) {
        errors++;
        console.error(`  ERROR updating parent ${parentId} attributes: ${err.message}`);
      }
    }

    if (errors > 0) {
      console.log(`\n  Encountered ${errors} errors. Rolling back transaction.`);
      await db.rollback();
      console.log('  Transaction rolled back.');
    } else {
      await db.commit();
      console.log(`\n  Transaction committed successfully.`);
      console.log(`    Terms created:           ${termCreations}`);
      console.log(`    Attributes updated:      ${attrUpdates}`);
      console.log(`    New attributes inserted: ${attrInserts}`);
      console.log(`    Parent attrs updated:    ${parentAttrUpdates}`);
    }
  } catch (err) {
    await db.rollback();
    throw err;
  }
}

// ==================== OUTPUT ====================

function printSummary(report: AnalysisReport) {
  const s = report.summary;
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Parents with duplicate variations: ${s.totalParentsWithDupes}`);
  console.log(`  Total duplicate sets:              ${s.totalDuplicateSets}`);
  console.log(`  Total variations in dupe sets:     ${s.totalDuplicateVariations}`);
  console.log(`  Fixable variations:                ${s.totalFixable}`);
  console.log(`  Unfixable variations:              ${s.totalUnfixable}`);
  console.log(`  SKUs not found in feeds:           ${s.totalSkusNotInFeed}`);
  console.log(`  New terms that would be created:   ${s.totalNewTermsNeeded}`);
}

function printSampleFixes(report: AnalysisReport, maxSamples: number = 20) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SAMPLE FIXES (first ${maxSamples})`);
  console.log('='.repeat(70));

  let shown = 0;
  for (const fix of report.fixes) {
    if (shown >= maxSamples) break;

    for (const ds of fix.duplicateSets) {
      if (shown >= maxSamples) break;
      if (ds.fixes.length === 0) continue;

      console.log(
        `\n  Parent: "${fix.parentTitle}" (ID: ${fix.parentId})`
      );
      console.log(`  Shared attr: ${ds.attrKey || '(empty)'}`);

      for (const action of ds.fixes) {
        console.log(
          `    Var ${action.variationId} (SKU: ${action.sku}): ` +
          `"${action.oldAttrValue}" -> "${action.newAttrSlug}" ` +
          `[${action.attrMetaKey}]`
        );
        if (action.feedName) {
          console.log(`      Feed name: ${action.feedName}`);
        }
        if (action.termNeedsCreation) {
          console.log(`      (new term needed in ${action.attrTaxonomy})`);
        }
      }

      if (ds.unfixable.length > 0) {
        for (const u of ds.unfixable) {
          console.log(
            `    Var ${u.variationId} (SKU: ${u.sku}): UNFIXABLE - ${u.reason}`
          );
        }
      }

      shown++;
    }
  }
}

function saveReport(report: AnalysisReport, outputPath: string) {
  const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report written to: ${outputPath}`);
}

// ==================== MAIN ====================

async function main() {
  const opts = parseArgs();

  console.log(`\nFix Duplicate Variations - Mode: ${opts.mode.toUpperCase()}`);
  console.log('='.repeat(70));

  // Step 1: Build SKU lookup from feeds
  const skuMap = await buildSkuLookup();

  // Step 2: Connect to DB and find duplicates
  const db = await getConnection();

  try {
    const parentDupes = await findAllDuplicateSets(db, opts);

    if (parentDupes.length === 0) {
      console.log('\nNo duplicate variations found. Nothing to fix.');
      return;
    }

    // Step 3: Plan fixes
    const report = await planFixes(db, parentDupes, skuMap, opts);

    // Print summary
    printSummary(report);

    // Print samples
    printSampleFixes(report);

    // Save report
    const outputPath = opts.output.startsWith('/')
      ? opts.output
      : `${BASE_DIR}/${opts.output}`;
    saveReport(report, outputPath);

    // Mode-specific actions
    if (opts.mode === 'dry-run') {
      console.log(`\n${'='.repeat(70)}`);
      console.log('DRY RUN - SQL STATEMENTS');
      console.log('='.repeat(70));
      const sql = generateSql(report);
      for (const stmt of sql) {
        console.log(stmt);
      }
      console.log(`\nTotal statements: ${sql.filter(s => !s.startsWith('--')).length}`);
    }

    if (opts.mode === 'apply') {
      if (report.summary.totalFixable === 0) {
        console.log('\nNo fixable variations found. Nothing to apply.');
      } else {
        await applyFixes(db, report, opts);
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
