#!/usr/bin/env bun

/**
 * Enforce Single Variation Attribute Per Product
 *
 * After V2.2 split-variation-products and fix-duplicate-variations, many
 * variable products have 2+ variation attributes (e.g., pa_size AND pa_color).
 * This script ensures every variable product has exactly 1 variation attribute.
 *
 * It also reclassifies pa_variant to pa_color or pa_size when all values
 * are clearly one type.
 *
 * Usage:
 *   bun scripts/enforce-single-attribute.ts [mode] [options]
 *
 * Modes:
 *   --analyze         Analyze and report (default). Writes JSON report.
 *   --dry-run         Show exact SQL that would run
 *   --apply           Execute changes in a transaction
 *
 * Options:
 *   --local           Connect to local DB (default is remote via SSH tunnel)
 *   --output <file>   JSON report path (default: scripts/output/enforce-report.json)
 *   --limit <n>       Limit number of parent products to process
 *   --parent <id>     Only process a specific parent product ID
 *   --verbose         Print extra debug info
 *   --help, -h        Show help
 */

import { createReadStream, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getConnection } from './lib/db';

// ==================== TYPES ====================

interface FeedProduct {
  sku: string;
  barcode: string;
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

interface ScriptOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  output: string;
  limit?: number;
  parentId?: number;
  verbose: boolean;
}

interface VariationRow {
  id: number;
  parentId: number;
  status: string;
  sku: string;
  warehouseSku: string;
  regularPrice: number;
  attrs: Map<string, string>; // meta_key (attribute_pa_*) -> meta_value
}

interface MultiAttrParent {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  attrKeys: string[];       // e.g. ['attribute_pa_size', 'attribute_pa_color']
  variations: VariationRow[];
  productAttributes: Record<string, any>; // deserialized _product_attributes
  isLubricant: boolean;
}

interface MisclassifiedParent {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  variations: VariationRow[];
  currentAttr: string;        // e.g. 'pa_variant', 'pa_style', 'pa_flavor'
  attrValues: string[];
  reclassifyTo: string;       // target taxonomy e.g. 'pa_color', 'pa_size', 'pa_variant'
  isLubricant: boolean;
  productAttributes: Record<string, any>;
}

type ActionType = 'split' | 'fold' | 'reclassify';

interface SplitGroupPlan {
  label: string;
  splitValue: string;         // The split dimension value (e.g., "6 Inch")
  variationIds: number[];
  newParentTitle: string;
  newParentSlug: string;
  isKeepGroup: boolean;       // True = stays on original parent
}

interface EnforceAction {
  type: ActionType;
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  isLubricant?: boolean;
  splitDimension?: string;    // e.g. 'pa_size' - the attribute being removed
  keepDimension?: string;     // e.g. 'pa_color' - the attribute being kept (before reclassify)
  groups?: SplitGroupPlan[];
  reclassifyFrom?: string;    // e.g. 'pa_variant'
  reclassifyTo?: string;      // e.g. 'pa_color'
  /** When the kept dimension after split/fold needs reclassification too */
  reclassifyKeptFrom?: string; // e.g. 'pa_style' (intermediate kept dim)
  reclassifyKeptTo?: string;   // e.g. 'pa_color' (final target)
  newTermsNeeded: string[];
  reason: string;
}

interface EnforceReport {
  timestamp: string;
  summary: {
    totalMultiAttrParents: number;
    totalMisclassifiedParents: number;
    totalSplits: number;
    totalFolds: number;
    totalReclassifications: number;
    totalNewParentsToCreate: number;
    totalNewTermsCreated: number;
    totalVariationsAffected: number;
  };
  actions: EnforceAction[];
  skipped: Array<{ parentId: number; parentTitle: string; reason: string }>;
}

// ==================== ARGUMENT PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const opts: ScriptOptions = {
    mode: 'analyze',
    output: 'scripts/output/enforce-report.json',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--analyze': opts.mode = 'analyze'; break;
      case '--dry-run': opts.mode = 'dry-run'; break;
      case '--apply': opts.mode = 'apply'; break;
      case '--output': opts.output = args[++i]; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--parent': opts.parentId = parseInt(args[++i], 10); break;
      case '--verbose': opts.verbose = true; break;
      case '--help': case '-h': printHelp(); process.exit(0);
      case '--local': case '--remote': break;
      case '--db': i++; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Enforce Single Variation Attribute Per Product
===============================================
Ensures every variable product has exactly 1 variation attribute.
Splits multi-attribute products and reclassifies misclassified pa_variant.

Usage: bun scripts/enforce-single-attribute.ts [mode] [options]

Modes:
  --analyze     Analyze and write JSON report (default)
  --dry-run     Show exact SQL that would be executed
  --apply       Execute changes in a database transaction

Options:
  --local       Connect to local DB (via socket)
  --output <f>  JSON report path (default: scripts/output/enforce-report.json)
  --limit <n>   Limit number of parent products to process
  --parent <id> Only process a specific parent product ID
  --verbose     Print extra debug info
  --help, -h    Show this help
`);
}

// ==================== CONSTANTS ====================

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';

const WILLIAMS_XML_FILES = [
  `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
];

const STC_CSV_FILE = `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`;

const LUBRICANT_CATEGORY_SLUGS = [
  'lubricants', 'water-based', 'silicone-based',
  'anal-lubes-lotions-sprays-creams', 'flavored', 'massage-lotions-creams',
];

// ==================== CLASSIFICATION WORD LISTS ====================

const SIZE_WORDS = new Set([
  'small', 'medium', 'large', 'mini', 'petite', 'regular', 'jumbo', 'giant', 'king',
  'xs', 'sm', 'md', 'med', 'lg', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl',
  'x-small', 'x-large', 'xx-large', 'xxx-large',
  's/m', 'm/l', 'l/xl', 'xl/xxl', 'o/s', 'os', 'one size', 'queen', 'q/s',
  '1x', '2x', '3x', '4x', '1x/2x', '3x/4x',
  'jr', 'junior', 'senior',
]);

const SIZE_UNIT_RE = /\b\d+(\.\d+)?\s*(oz|ounces?|fl\.?\s*oz|ml|milliliters?|l|liters?|g|grams?|mg|lb|lbs|pounds?|inches?|in\.?|"|″|mm|cm|centimeters?|ft|feet|pc|pk|pack|count|ct)\b/i;

const COLOR_WORDS = new Set([
  'red', 'blue', 'green', 'pink', 'purple', 'black', 'white', 'clear', 'silver', 'gold',
  'bronze', 'copper', 'grey', 'gray', 'brown', 'yellow', 'teal', 'navy', 'nude', 'tan',
  'beige', 'ivory', 'orange', 'wine', 'burgundy', 'charcoal', 'coral', 'fuchsia', 'indigo',
  'magenta', 'maroon', 'olive', 'plum', 'salmon', 'turquoise', 'violet', 'rose', 'flesh',
  'midnight', 'pearl', 'matte', 'neon', 'chrome', 'rainbow',
  'blk', 'wht', 'pnk', 'prp', 'blu', 'grn', 'gld', 'slv', 'brn', 'ylw',
]);

const FORMULA_WORDS = new Set([
  'silicone', 'water', 'h2o', 'water-based', 'oil', 'hybrid', 'warming', 'cooling',
  'tingling', 'original', 'classic', 'natural', 'organic', 'gel', 'cream', 'foam',
  'liquid', 'spray', 'mousse',
]);

const COLOR_NORMALIZATION_MAP: Record<string, string> = {
  'blk': 'Black', 'blck': 'Black', 'jet black': 'Black', 'midnight black': 'Black', 'onyx': 'Black',
  'wht': 'White', 'off white': 'Off-White', 'ivory': 'Ivory', 'cream': 'Cream', 'pearl': 'Pearl',
  'pnk': 'Pink', 'hot pink': 'Hot Pink', 'light pink': 'Light Pink', 'baby pink': 'Baby Pink',
  'blush': 'Blush', 'rose': 'Rose', 'fuchsia': 'Fuchsia', 'magenta': 'Magenta',
  'prpl': 'Purple', 'violet': 'Violet', 'lavender': 'Lavender', 'plum': 'Plum', 'grape': 'Purple',
  'blu': 'Blue', 'navy': 'Navy', 'navy blue': 'Navy', 'royal blue': 'Royal Blue',
  'light blue': 'Light Blue', 'sky blue': 'Sky Blue', 'teal': 'Teal', 'turquoise': 'Turquoise',
  'aqua': 'Aqua', 'cobalt': 'Cobalt',
  'grn': 'Green', 'lime': 'Lime', 'lime green': 'Lime', 'olive': 'Olive',
  'forest green': 'Forest Green', 'mint': 'Mint', 'mint green': 'Mint', 'emerald': 'Emerald',
  'rd': 'Red', 'crimson': 'Crimson', 'scarlet': 'Scarlet', 'burgundy': 'Burgundy',
  'maroon': 'Maroon', 'wine': 'Wine', 'cherry': 'Cherry',
  'org': 'Orange', 'tangerine': 'Orange', 'peach': 'Peach', 'coral': 'Coral', 'salmon': 'Salmon',
  'ylw': 'Yellow', 'gold': 'Gold', 'golden': 'Gold', 'lemon': 'Yellow', 'mustard': 'Mustard',
  'brn': 'Brown', 'tan': 'Tan', 'beige': 'Beige', 'caramel': 'Caramel',
  'chocolate': 'Chocolate', 'mocha': 'Mocha', 'coffee': 'Coffee', 'bronze': 'Bronze',
  'gry': 'Gray', 'grey': 'Gray', 'silver': 'Silver', 'charcoal': 'Charcoal', 'slate': 'Slate',
  'multi': 'Multi-Color', 'multicolor': 'Multi-Color', 'multi-colored': 'Multi-Color',
  'rainbow': 'Rainbow', 'assorted': 'Assorted',
  'clr': 'Clear', 'transparent': 'Clear', 'see-through': 'Clear',
  'flesh': 'Flesh', 'nude': 'Nude', 'skin': 'Flesh', 'light flesh': 'Light Flesh',
  'dark flesh': 'Dark Flesh', 'vanilla': 'Vanilla', 'caramel flesh': 'Caramel',
  'chocolate flesh': 'Chocolate',
  'rose gold': 'Rose Gold', 'chrome': 'Chrome', 'copper': 'Copper', 'brass': 'Brass',
};

// ==================== FEED PARSING (LAZY) ====================

let _skuLookupCache: Map<string, FeedProduct> | null = null;
let _barcodeToWtSkuCache: Map<string, string> | null = null;

async function getSkuLookup(): Promise<Map<string, FeedProduct>> {
  if (_skuLookupCache) return _skuLookupCache;
  await buildSkuLookup();
  return _skuLookupCache!;
}

async function getBarcodeToWtSku(): Promise<Map<string, string>> {
  if (_barcodeToWtSkuCache) return _barcodeToWtSkuCache;
  await buildSkuLookup();
  return _barcodeToWtSkuCache!;
}

async function parseWilliamsXml(
  filePath: string, skuMap: Map<string, FeedProduct>, barcodeMap: Map<string, string>
): Promise<number> {
  if (!existsSync(filePath)) { console.log(`  [skip] File not found: ${filePath}`); return 0; }
  const fileSize = `${(Bun.file(filePath).size / 1024 / 1024).toFixed(1)}MB`;
  console.log(`  Parsing ${filePath.split('/').pop()} (${fileSize})...`);

  return new Promise<number>((resolve, reject) => {
    let count = 0;
    let inProduct = false;
    let currentProduct: Partial<FeedProduct> = {};
    let buffer = '';

    const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      buffer += line + '\n';
      if (line.includes('<product ') || line.trim() === '<product>') {
        inProduct = true; currentProduct = { source: 'williams' }; buffer = line + '\n';
      }
      if (inProduct && line.includes('</product>')) {
        const block = buffer;
        const sku = extractXmlField(block, 'sku');
        if (sku) {
          const barcode = extractXmlField(block, 'barcode');
          currentProduct.sku = sku;
          currentProduct.barcode = barcode;
          currentProduct.name = extractXmlCdata(block, 'name') || extractXmlField(block, 'name') || '';
          currentProduct.color = extractXmlField(block, 'color') || '';
          currentProduct.material = extractXmlField(block, 'material') || '';
          currentProduct.height = extractXmlField(block, 'height') || '';
          currentProduct.length = extractXmlField(block, 'length') || '';
          currentProduct.diameter = extractXmlField(block, 'diameter') || '';
          currentProduct.weight = extractXmlField(block, 'weight') || '';
          currentProduct.size = '';
          currentProduct.description = extractXmlCdata(block, 'description') || '';
          if (!skuMap.has(sku)) { skuMap.set(sku, currentProduct as FeedProduct); count++; }
          if (barcode && !barcodeMap.has(barcode)) barcodeMap.set(barcode, sku);
        }
        inProduct = false; buffer = '';
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

async function parseStcCsv(
  filePath: string, skuMap: Map<string, FeedProduct>, barcodeMap: Map<string, string>
): Promise<number> {
  if (!existsSync(filePath)) { console.log(`  [skip] File not found: ${filePath}`); return 0; }
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
      const name = (row['Product Name'] || '').trim();
      if (!handle && !upc) return;

      const product: FeedProduct = {
        sku: handle, barcode: upc, name,
        color: (row['Color'] || '').trim(), material: (row['Material'] || '').trim(),
        size: (row['Size'] || '').trim(), height: (row['Height'] || '').trim(),
        length: (row['Length'] || '').trim(), diameter: '', weight: (row['Weight'] || '').trim(),
        description: (row['Description'] || '').trim(), source: 'stc',
      };

      if (handle && !skuMap.has(handle)) { skuMap.set(handle, product); count++; }
      if (upc && !skuMap.has(upc)) skuMap.set(upc, { ...product, sku: upc });
      if (upc && handle && !barcodeMap.has(upc)) barcodeMap.set(upc, handle);
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}

async function buildSkuLookup(): Promise<Map<string, FeedProduct>> {
  console.log('\n--- Building SKU lookup from product feeds ---');
  const skuMap = new Map<string, FeedProduct>();
  const barcodeMap = new Map<string, string>();

  for (const xmlFile of WILLIAMS_XML_FILES) {
    const count = await parseWilliamsXml(xmlFile, skuMap, barcodeMap);
    console.log(`    -> Added ${count.toLocaleString()} products`);
  }
  const stcCount = await parseStcCsv(STC_CSV_FILE, skuMap, barcodeMap);
  console.log(`    -> Added ${stcCount.toLocaleString()} STC products`);
  console.log(`  Total SKU lookup entries: ${skuMap.size.toLocaleString()}`);

  _skuLookupCache = skuMap;
  _barcodeToWtSkuCache = barcodeMap;
  return skuMap;
}

// ==================== PHP SERIALIZATION ====================

function deserializePhpArray(str: string): Record<string, any> {
  try {
    if (!str.startsWith('a:')) return {};
    let pos = 0;

    function readString(): string {
      if (str[pos] !== 's') throw new Error(`Expected 's' at ${pos}`);
      pos++; pos++;
      let lenStr = '';
      while (str[pos] !== ':') { lenStr += str[pos]; pos++; }
      pos++; pos++;
      const len = parseInt(lenStr, 10);
      const val = str.substring(pos, pos + len);
      pos += len;
      pos++; pos++;
      return val;
    }

    function readInt(): number {
      pos++; pos++;
      let numStr = '';
      while (str[pos] !== ';') { numStr += str[pos]; pos++; }
      pos++;
      return parseInt(numStr, 10);
    }

    function readValue(): any {
      if (str[pos] === 's') return readString();
      if (str[pos] === 'i') return readInt();
      if (str[pos] === 'a') return readArray();
      if (str[pos] === 'b') { pos++; pos++; const val = str[pos] === '1'; pos++; pos++; return val; }
      if (str[pos] === 'N') { pos++; pos++; return null; }
      if (str[pos] === 'd') {
        pos++; pos++;
        let numStr = '';
        while (str[pos] !== ';') { numStr += str[pos]; pos++; }
        pos++;
        return parseFloat(numStr);
      }
      throw new Error(`Unknown type '${str[pos]}' at pos ${pos}`);
    }

    function readArray(): Record<string, any> {
      pos++; pos++;
      let countStr = '';
      while (str[pos] !== ':') { countStr += str[pos]; pos++; }
      pos++; pos++;
      const count = parseInt(countStr, 10);
      const obj: Record<string, any> = {};
      for (let i = 0; i < count; i++) {
        const key = str[pos] === 'i' ? String(readInt()) : readString();
        const value = readValue();
        obj[key] = value;
      }
      pos++;
      return obj;
    }

    return readArray();
  } catch { return {}; }
}

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
        if (/^\d+$/.test(k)) inner += `i:${parseInt(k, 10)};`;
        else inner += `s:${k.length}:"${k}";`;
        inner += ser(v);
      }
      return `a:${entries.length}:{${inner}}`;
    }
    const s = String(val);
    return `s:${s.length}:"${s}";`;
  }
  return ser(obj);
}

// ==================== UTILITY FUNCTIONS ====================

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];
  const wordArrays = strings.map(s => s.split(/\s+/));
  const minLen = Math.min(...wordArrays.map(w => w.length));
  const commonWords: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const word = wordArrays[0][i];
    if (wordArrays.every(wa => wa[i].toLowerCase() === word.toLowerCase())) {
      commonWords.push(word);
    } else break;
  }
  return commonWords.join(' ');
}

async function ensureUniqueSlug(db: Connection, baseSlug: string, excludeId: number): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const [existing] = await db.query<RowDataPacket[]>(
      `SELECT ID FROM wp_posts WHERE post_name = ? AND ID != ? AND post_type = 'product' LIMIT 1`,
      [slug, excludeId]
    );
    if (existing.length === 0) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
    if (suffix > 100) throw new Error(`Could not generate unique slug for "${baseSlug}"`);
  }
}

async function getVariationPrices(db: Connection, varIds: number[]): Promise<number[]> {
  if (varIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT meta_value FROM wp_postmeta
     WHERE post_id IN (${varIds.join(',')}) AND meta_key = '_price'
       AND meta_value != '' AND meta_value IS NOT NULL`
  );
  return rows.map(r => parseFloat(r.meta_value)).filter(p => p > 0 && isFinite(p));
}

function classifyValue(text: string): 'color' | 'size' | 'formula' | 'variant' {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/[\s\-\/]+/).filter(Boolean);

  if (SIZE_UNIT_RE.test(lower)) return 'size';
  if (words.length > 0 && words.every(w => SIZE_WORDS.has(w))) return 'size';
  if (COLOR_WORDS.has(lower) || (words.length <= 2 && words.every(w => COLOR_WORDS.has(w)))) return 'color';
  if (FORMULA_WORDS.has(lower) || words.some(w => FORMULA_WORDS.has(w))) {
    if (!words.some(w => COLOR_WORDS.has(w))) return 'formula';
  }
  if (/\b\d+(\.\d+)?\b/.test(lower) && !words.some(w => COLOR_WORDS.has(w))) return 'size';

  return 'variant';
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (COLOR_NORMALIZATION_MAP[lower]) return COLOR_NORMALIZATION_MAP[lower];
  return trimmed.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function normalizeSize(size: string): string {
  const trimmed = size.trim();
  if (!trimmed) return trimmed;
  // Normalize patterns like "6 Inch" -> "6 Inch", "8oz" -> "8 Oz"
  return trimmed
    .replace(/(\d)\s*(oz|ml|inch|inches|in|cm|mm|fl\s*oz)/gi, (_, num, unit) => {
      const normalizedUnit = unit.toLowerCase()
        .replace(/^inches?$/i, 'Inch')
        .replace(/^in$/i, 'Inch')
        .replace(/^oz$/i, 'Oz')
        .replace(/^ml$/i, 'ml')
        .replace(/^cm$/i, 'cm')
        .replace(/^mm$/i, 'mm')
        .replace(/^fl\s*oz$/i, 'Fl Oz');
      return `${num} ${normalizedUnit}`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================== PHASE 1: DISCOVERY ====================

async function findMultiAttrParents(
  db: Connection, opts: ScriptOptions
): Promise<MultiAttrParent[]> {
  console.log('\n--- Phase 1A: Finding multi-attribute parents ---');

  let parentFilter = '';
  const params: (string | number)[] = [];
  if (opts.parentId) {
    parentFilter = `AND v.post_parent = ?`;
    params.push(opts.parentId);
  }

  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT v.post_parent as parentId, COUNT(DISTINCT pm.meta_key) as attr_count,
           GROUP_CONCAT(DISTINCT pm.meta_key ORDER BY pm.meta_key) as attr_keys
    FROM wp_posts v
    JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key LIKE 'attribute_pa_%'
    WHERE v.post_type = 'product_variation' ${parentFilter}
    GROUP BY v.post_parent
    HAVING attr_count >= 2
  `, params);

  console.log(`  Found ${rows.length} parents with 2+ variation attributes`);

  if (rows.length === 0) return [];

  // Apply limit
  const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
  const parentIds = limited.map(r => r.parentId);

  // Load parent info
  const [parentInfo] = await db.query<RowDataPacket[]>(
    `SELECT ID, post_title, post_name FROM wp_posts WHERE ID IN (${parentIds.join(',')})`
  );
  const parentMap = new Map(parentInfo.map(p => [p.ID, p]));

  // Load _product_attributes
  const [attrMeta] = await db.query<RowDataPacket[]>(
    `SELECT post_id, meta_value FROM wp_postmeta
     WHERE post_id IN (${parentIds.join(',')}) AND meta_key = '_product_attributes'`
  );
  const productAttrsMap = new Map<number, Record<string, any>>();
  for (const row of attrMeta) {
    if (row.meta_value) productAttrsMap.set(row.post_id, deserializePhpArray(row.meta_value));
  }

  // Load lubricant parent IDs
  const lubricantIds = await findLubricantParents(db, parentIds);

  // Load variations with attributes and meta
  const variations = await loadVariationsForParents(db, parentIds);

  const results: MultiAttrParent[] = [];
  for (const row of limited) {
    const parent = parentMap.get(row.parentId);
    if (!parent) continue;

    results.push({
      parentId: row.parentId,
      parentTitle: parent.post_title,
      parentSlug: parent.post_name,
      attrKeys: (row.attr_keys as string).split(','),
      variations: variations.get(row.parentId) || [],
      productAttributes: productAttrsMap.get(row.parentId) || {},
      isLubricant: lubricantIds.has(row.parentId),
    });
  }

  return results;
}

async function findMisclassifiedVariants(
  db: Connection, opts: ScriptOptions, multiAttrParentIds: Set<number>
): Promise<MisclassifiedParent[]> {
  console.log('\n--- Phase 1B: Finding single-attribute products with non-allowed attributes ---');

  // Allowed single attributes:
  //   Non-lubricant: pa_color, pa_size
  //   Lubricant:     pa_size, pa_variant

  let parentFilter = '';
  const params: (string | number)[] = [];
  if (opts.parentId) {
    parentFilter = `AND v.post_parent = ?`;
    params.push(opts.parentId);
  }

  // Find all single-attribute parents (only 1 distinct attribute_pa_* key)
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT v.post_parent as parentId,
           MIN(pm.meta_key) as attr_key,
           GROUP_CONCAT(DISTINCT pm.meta_value ORDER BY pm.meta_value) as attr_values,
           COUNT(DISTINCT pm.meta_key) as key_count,
           COUNT(DISTINCT pm.meta_value) as value_count
    FROM wp_posts v
    JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key LIKE 'attribute_pa_%'
    WHERE v.post_type = 'product_variation' ${parentFilter}
    GROUP BY v.post_parent
    HAVING key_count = 1 AND value_count >= 2
  `, params);

  // Filter out multi-attr parents (already handled) and those with allowed attributes
  // We need to know lubricant status to determine if the attribute is allowed
  const candidateIds = rows
    .filter(r => !multiAttrParentIds.has(r.parentId))
    .map(r => r.parentId);

  if (candidateIds.length === 0) {
    console.log('  No single-attribute reclassification candidates found');
    return [];
  }

  // Determine lubricant status for all candidates
  const lubricantIds = await findLubricantParents(db, candidateIds);

  // Filter to only those with non-allowed attributes
  const nonAllowed = rows.filter(r => {
    if (multiAttrParentIds.has(r.parentId)) return false;
    const taxonomy = (r.attr_key as string).replace('attribute_', '');
    const isLube = lubricantIds.has(r.parentId);
    if (isLube) {
      // Lubricants: pa_size and pa_variant are allowed
      return taxonomy !== 'pa_size' && taxonomy !== 'pa_variant';
    } else {
      // Non-lubricants: pa_color and pa_size are allowed
      return taxonomy !== 'pa_color' && taxonomy !== 'pa_size';
    }
  });

  if (nonAllowed.length === 0) {
    console.log('  No misclassified single-attribute products found');
    return [];
  }

  // Load parent info in batch
  const nonAllowedIds = nonAllowed.map(r => r.parentId);
  const [parentInfoRows] = await db.query<RowDataPacket[]>(
    `SELECT ID, post_title, post_name FROM wp_posts WHERE ID IN (${nonAllowedIds.join(',')})`
  );
  const parentInfoMap = new Map(parentInfoRows.map(p => [p.ID, p]));

  // Load _product_attributes in batch
  const [attrMetaRows] = await db.query<RowDataPacket[]>(
    `SELECT post_id, meta_value FROM wp_postmeta
     WHERE post_id IN (${nonAllowedIds.join(',')}) AND meta_key = '_product_attributes'`
  );
  const prodAttrsMap = new Map<number, Record<string, any>>();
  for (const row of attrMetaRows) {
    if (row.meta_value) prodAttrsMap.set(row.post_id, deserializePhpArray(row.meta_value));
  }

  // Load variations in batch
  const variationsMap = await loadVariationsForParents(db, nonAllowedIds);

  const results: MisclassifiedParent[] = [];

  for (const row of nonAllowed) {
    const parent = parentInfoMap.get(row.parentId);
    if (!parent) continue;

    const currentAttr = (row.attr_key as string).replace('attribute_', '');
    const values = (row.attr_values as string).split(',').map(v => v.trim()).filter(Boolean);
    const isLube = lubricantIds.has(row.parentId);

    // Determine reclassification target
    let reclassifyTo: string;
    if (isLube) {
      // Lubricant with non-allowed attr → reclassify to pa_variant (type/formula)
      // Unless all values are sizes, then → pa_size
      const allSizes = values.every(v => classifyValue(v) === 'size');
      reclassifyTo = allSizes ? 'pa_size' : 'pa_variant';
    } else {
      // Non-lubricant with non-allowed attr → classify values
      const classifications = values.map(v => classifyValue(v));
      const allSizes = classifications.every(c => c === 'size');
      reclassifyTo = allSizes ? 'pa_size' : 'pa_color';
    }

    results.push({
      parentId: row.parentId,
      parentTitle: parent.post_title,
      parentSlug: parent.post_name,
      variations: variationsMap.get(row.parentId) || [],
      currentAttr,
      attrValues: values,
      reclassifyTo,
      isLubricant: isLube,
      productAttributes: prodAttrsMap.get(row.parentId) || {},
    });
  }

  if (opts.limit) results.length = Math.min(results.length, opts.limit);

  const toColor = results.filter(r => r.reclassifyTo === 'pa_color').length;
  const toSize = results.filter(r => r.reclassifyTo === 'pa_size').length;
  const toVariant = results.filter(r => r.reclassifyTo === 'pa_variant').length;
  console.log(`  Found ${results.length} misclassified single-attr parents (→ color: ${toColor}, → size: ${toSize}, → variant: ${toVariant})`);
  return results;
}

async function findLubricantParents(db: Connection, parentIds: number[]): Promise<Set<number>> {
  if (parentIds.length === 0) return new Set();

  const slugPlaceholders = LUBRICANT_CATEGORY_SLUGS.map(() => '?').join(',');
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT DISTINCT tr.object_id
    FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE tt.taxonomy = 'product_cat'
      AND t.slug IN (${slugPlaceholders})
      AND tr.object_id IN (${parentIds.join(',')})
  `, LUBRICANT_CATEGORY_SLUGS);

  return new Set(rows.map(r => r.object_id));
}

async function loadVariationsForParents(
  db: Connection, parentIds: number[]
): Promise<Map<number, VariationRow[]>> {
  if (parentIds.length === 0) return new Map();

  const [varRows] = await db.query<RowDataPacket[]>(`
    SELECT v.ID as id, v.post_parent as parentId, v.post_status as status
    FROM wp_posts v
    WHERE v.post_type = 'product_variation'
      AND v.post_parent IN (${parentIds.join(',')})
    ORDER BY v.post_parent, v.ID
  `);

  const varIds = varRows.map(v => v.id);
  if (varIds.length === 0) return new Map();

  // Batch load meta
  const [metaRows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_key, meta_value
    FROM wp_postmeta
    WHERE post_id IN (${varIds.join(',')})
      AND (meta_key LIKE 'attribute_pa_%' OR meta_key IN ('_sku', '_wt_sku', '_regular_price'))
      AND meta_value IS NOT NULL
  `);

  const metaByVar = new Map<number, Map<string, string>>();
  for (const r of metaRows) {
    if (!metaByVar.has(r.post_id)) metaByVar.set(r.post_id, new Map());
    metaByVar.get(r.post_id)!.set(r.meta_key, r.meta_value || '');
  }

  const result = new Map<number, VariationRow[]>();
  for (const v of varRows) {
    const meta = metaByVar.get(v.id) || new Map<string, string>();
    const attrs = new Map<string, string>();
    for (const [key, val] of meta) {
      if (key.startsWith('attribute_pa_')) attrs.set(key, val);
    }

    const varRow: VariationRow = {
      id: v.id,
      parentId: v.parentId,
      status: v.status,
      sku: meta.get('_sku') || '',
      warehouseSku: meta.get('_wt_sku') || '',
      regularPrice: parseFloat(meta.get('_regular_price') || '0') || 0,
      attrs,
    };

    if (!result.has(v.parentId)) result.set(v.parentId, []);
    result.get(v.parentId)!.push(varRow);
  }

  return result;
}

// ==================== PHASE 2: ANALYSIS & SPLIT PLANNING ====================

function decideSplitDimension(parent: MultiAttrParent): {
  splitDim: string; keepDim: string;
  reclassifyKeptFrom?: string; reclassifyKeptTo?: string;
} | null {
  const attrs = parent.attrKeys.map(k => k.replace('attribute_', ''));
  // attrs is like ['pa_size', 'pa_color', 'pa_variant']

  const hasSize = attrs.includes('pa_size');
  const hasColor = attrs.includes('pa_color');
  const hasVariant = attrs.includes('pa_variant');
  const hasStyle = attrs.includes('pa_style');
  const hasFlavor = attrs.includes('pa_flavor');

  // ── Allowed final attributes ──
  // Non-lubricants: pa_color OR pa_size
  // Lubricants:     pa_size  OR pa_variant (type/formula)
  //
  // Split = the dimension we split by (each value → separate product, then removed)
  // Keep  = the dimension that stays as the variation attribute
  // If "keep" isn't in the allowed set, we flag reclassifyKeptTo so it gets renamed post-split.

  let splitDim: string;
  let keepDim: string;

  if (parent.isLubricant) {
    // ── LUBRICANTS ── allowed: pa_size, pa_variant
    // "type" attrs are pa_variant, pa_style, pa_flavor, pa_color (formula-like values)
    // "size" attr is pa_size

    // Find the best "type" attribute present
    const typeAttr = hasVariant ? 'pa_variant'
                   : hasStyle ? 'pa_style'
                   : hasFlavor ? 'pa_flavor'
                   : hasColor ? 'pa_color' : null;

    if (hasSize && typeAttr) {
      // Both size and type present — split whichever has fewer distinct values
      const sizeValues = new Set<string>();
      const typeValues = new Set<string>();
      for (const v of parent.variations) {
        const sv = v.attrs.get('attribute_pa_size');
        const tv = v.attrs.get(`attribute_${typeAttr}`);
        if (sv) sizeValues.add(sv);
        if (tv) typeValues.add(tv);
      }
      if (typeValues.size > sizeValues.size) {
        splitDim = typeAttr; keepDim = 'pa_size';
      } else {
        splitDim = 'pa_size'; keepDim = typeAttr;
      }
    } else if (hasSize) {
      // Only size + something non-type → split by the other, keep size
      const other = attrs.find(a => a !== 'pa_size')!;
      splitDim = other; keepDim = 'pa_size';
    } else if (typeAttr) {
      // No size → split by any secondary type, keep primary type
      const otherType = attrs.find(a => a !== typeAttr)!;
      splitDim = otherType; keepDim = typeAttr;
    } else {
      // Fallback
      splitDim = attrs[0]; keepDim = attrs[1];
    }
  } else {
    // ── NON-LUBRICANTS ── allowed: pa_color, pa_size
    // Split priority: pa_size first (each size = separate product)
    // Keep priority:  pa_color first (customers pick color from dropdown)

    if (hasSize && hasColor) {
      splitDim = 'pa_size'; keepDim = 'pa_color';
    } else if (hasSize) {
      // pa_size + something else → split by size, keep the other (will be reclassified to pa_color)
      const other = attrs.find(a => a !== 'pa_size')!;
      splitDim = 'pa_size'; keepDim = other;
    } else if (hasColor) {
      // pa_color + something else → split by the other, keep color
      const other = attrs.find(a => a !== 'pa_color')!;
      splitDim = other; keepDim = 'pa_color';
    } else {
      // No size or color → pick best split/keep from what's available
      // Split by whichever has more values, keep the other (both will need reclassify)
      const valCounts: [string, number][] = attrs.map(a => {
        const key = `attribute_${a}`;
        const vals = new Set(parent.variations.map(v => v.attrs.get(key)).filter(Boolean));
        return [a, vals.size] as [string, number];
      });
      valCounts.sort((a, b) => b[1] - a[1]);
      splitDim = valCounts[0][0]; keepDim = valCounts[1][0];
    }
  }

  // ── Determine if keepDim needs post-split reclassification ──
  const allowedKeep = parent.isLubricant
    ? new Set(['pa_size', 'pa_variant'])
    : new Set(['pa_color', 'pa_size']);

  let reclassifyKeptFrom: string | undefined;
  let reclassifyKeptTo: string | undefined;

  if (!allowedKeep.has(keepDim)) {
    reclassifyKeptFrom = keepDim;
    if (parent.isLubricant) {
      // Lubes: non-allowed kept dim → reclassify to pa_variant
      reclassifyKeptTo = 'pa_variant';
    } else {
      // Non-lubes: classify the kept dim's values to decide pa_color vs pa_size
      const keepMetaKey = `attribute_${keepDim}`;
      const keepValues = [...new Set(
        parent.variations.map(v => v.attrs.get(keepMetaKey)).filter(Boolean)
      )] as string[];
      const classifications = keepValues.map(v => classifyValue(v));
      const allSizes = classifications.every(c => c === 'size');
      reclassifyKeptTo = allSizes ? 'pa_size' : 'pa_color';
    }
  }

  return { splitDim, keepDim, reclassifyKeptFrom, reclassifyKeptTo };
}

function groupVariationsBySplitDimension(
  parent: MultiAttrParent, splitDim: string
): Map<string, VariationRow[]> {
  const groups = new Map<string, VariationRow[]>();
  const splitMetaKey = `attribute_${splitDim}`;

  for (const v of parent.variations) {
    const splitVal = v.attrs.get(splitMetaKey) || '_unset_';
    if (!groups.has(splitVal)) groups.set(splitVal, []);
    groups.get(splitVal)!.push(v);
  }

  return groups;
}

/**
 * Extract warehouse SKU prefix by stripping trailing 1-2 digit variant suffix.
 * e.g., BN12050 → BN1205, CNVEF-4839 → CNVEF-483
 */
function extractSkuPrefix(sku: string): string {
  if (!sku || sku.length < 3) return sku;

  let numStart = sku.length;
  for (let i = sku.length - 1; i >= 0; i--) {
    if (/\d/.test(sku[i])) { numStart = i; } else { break; }
  }
  if (numStart === sku.length) return sku;

  const alphaPart = sku.substring(0, numStart);
  const numPart = sku.substring(numStart);

  if (!alphaPart) {
    return numPart.length > 2 ? sku.substring(0, sku.length - 2) : sku;
  }

  if (numPart.length <= 2) {
    return alphaPart;
  }
  return sku.substring(0, sku.length - Math.min(2, numPart.length));
}

/**
 * Determine if variations should be split or folded using SKU prefix + price heuristics.
 *
 * Priority:
 *   1. SKU prefix — all same prefix = one product (fold)
 *   2. Price — all same price = one product (fold)
 *   3. Attribute values — fallback to grouping by split dim values
 *
 * Returns null if the product should be folded (all variations belong together).
 * Returns a Map of groups if they should be split apart.
 */
function determineProductLineGroups(
  parent: MultiAttrParent, splitDim: string, opts: ScriptOptions
): { shouldSplit: boolean; groups: Map<string, VariationRow[]>; method: string } {
  const variations = parent.variations;
  const splitMetaKey = `attribute_${splitDim}`;

  // ── Method 1: SKU prefix grouping ──
  // Resolve warehouse SKUs: use _wt_sku directly, or look up barcode → wt_sku from feed
  const barcodeMap = _barcodeToWtSkuCache;
  const resolvedSkus = new Map<number, string>(); // variation ID → warehouse SKU
  for (const v of variations) {
    let wtSku = v.warehouseSku;
    if (!wtSku && v.sku && barcodeMap) {
      wtSku = barcodeMap.get(v.sku) || '';
    }
    if (wtSku) resolvedSkus.set(v.id, wtSku);
  }

  const withSku = variations.filter(v => resolvedSkus.has(v.id));
  if (withSku.length >= variations.length * 0.5 && withSku.length >= 2) {
    const prefixGroups = new Map<string, VariationRow[]>();
    for (const v of withSku) {
      const prefix = extractSkuPrefix(resolvedSkus.get(v.id)!);
      if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
      prefixGroups.get(prefix)!.push(v);
    }

    // Add variations without SKU to the largest prefix group
    const noSku = variations.filter(v => !resolvedSkus.has(v.id));
    if (noSku.length > 0 && prefixGroups.size > 0) {
      const largestPrefix = [...prefixGroups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
      for (const v of noSku) {
        prefixGroups.get(largestPrefix)!.push(v);
      }
    }

    if (opts.verbose) {
      console.log(`    SKU prefixes: ${[...prefixGroups.entries()].map(([p, vs]) => `${p}(${vs.length})`).join(', ')}`);
    }

    if (prefixGroups.size === 1) {
      // All same SKU prefix → single product line → fold
      return { shouldSplit: false, groups: prefixGroups, method: 'sku-single' };
    }

    // Multiple prefixes found. Be conservative: only split when ALL groups
    // have 2+ variations (no singletons from discontinued items) AND
    // groups have different prices confirming separate product lines.
    const multiMemberGroups = [...prefixGroups.values()].filter(vs => vs.length >= 2);
    const singletonGroups = [...prefixGroups.values()].filter(vs => vs.length === 1);

    if (singletonGroups.length > 0) {
      // Has singletons (likely discontinued items) — fold everything together.
      // The V2.2 split already decided these belong in one product.
      return { shouldSplit: false, groups: prefixGroups, method: 'sku-has-singletons' };
    }

    // All groups have 2+ members. Confirm with price: each group should have
    // a uniform price that differs from other groups.
    const groupPrices = [...prefixGroups.entries()].map(([prefix, vars]) => {
      const prices = new Set(vars.map(v => v.regularPrice).filter(p => p > 0));
      return { prefix, vars, prices };
    });

    const allGroupsUniformPrice = groupPrices.every(g => g.prices.size <= 1);
    const distinctGroupPrices = new Set(groupPrices.map(g => [...g.prices][0]).filter(Boolean));

    if (allGroupsUniformPrice && distinctGroupPrices.size >= 2) {
      // Each group has a uniform price, and groups have different prices
      // → strong evidence of separate product lines → split
      return { shouldSplit: true, groups: prefixGroups, method: 'sku-prefix' };
    }

    // Ambiguous — fold to be safe
    return { shouldSplit: false, groups: prefixGroups, method: 'sku-ambiguous' };
  }

  // ── Method 2: Price grouping ──
  const prices = new Set(variations.map(v => v.regularPrice).filter(p => p > 0));
  if (prices.size <= 1) {
    // All same price (or no prices) → single product line → fold
    const singleGroup = new Map<string, VariationRow[]>();
    singleGroup.set('all', variations);
    return { shouldSplit: false, groups: singleGroup, method: 'price-single' };
  }

  if (prices.size >= 2) {
    // Group by price
    const priceGroups = new Map<string, VariationRow[]>();
    for (const v of variations) {
      const key = `$${v.regularPrice}`;
      if (!priceGroups.has(key)) priceGroups.set(key, []);
      priceGroups.get(key)!.push(v);
    }

    // Conservative: only split by price when ALL groups have 2+ variations
    // and no singleton groups (singletons are often discontinued items)
    const hasSingletons = [...priceGroups.values()].some(vs => vs.length === 1);
    if (hasSingletons) {
      return { shouldSplit: false, groups: priceGroups, method: 'price-has-singletons' };
    }

    return { shouldSplit: true, groups: priceGroups, method: 'price' };
  }

  // ── Method 3: Fallback to attribute value grouping ──
  const attrGroups = groupVariationsBySplitDimension(parent, splitDim);
  if (attrGroups.size <= 1) {
    return { shouldSplit: false, groups: attrGroups, method: 'attr-single' };
  }

  // Check for junk attribute values (contain parent title or are very long)
  const parentTitleLower = parent.parentTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  let hasJunkValues = false;
  for (const [val] of attrGroups) {
    if (val === '_unset_') continue;
    const valClean = val.replace(/-/g, '').toLowerCase();
    if (valClean.length > 25 || parentTitleLower.includes(valClean) || valClean.includes(parentTitleLower.substring(0, 10))) {
      hasJunkValues = true;
      break;
    }
  }

  if (hasJunkValues) {
    // Junk attribute values → fold
    return { shouldSplit: false, groups: attrGroups, method: 'attr-junk-detected' };
  }

  const allSingletons = [...attrGroups.values()].every(vs => vs.length === 1);
  if (allSingletons && attrGroups.size > 3) {
    return { shouldSplit: false, groups: attrGroups, method: 'attr-all-singletons' };
  }

  return { shouldSplit: true, groups: attrGroups, method: 'attr-values' };
}

async function planMultiAttrAction(
  db: Connection, parent: MultiAttrParent, opts: ScriptOptions
): Promise<EnforceAction | null> {
  const decision = decideSplitDimension(parent);
  if (!decision) return null;

  const { splitDim, keepDim, reclassifyKeptFrom, reclassifyKeptTo } = decision;

  // Use SKU/price heuristics to determine if we should split or fold
  const lineAnalysis = determineProductLineGroups(parent, splitDim, opts);

  const finalAttr = reclassifyKeptTo || keepDim;
  const reclassNote = reclassifyKeptTo ? ` (then reclassify ${keepDim} → ${reclassifyKeptTo})` : '';
  if (opts.verbose) {
    console.log(`  [${parent.parentId}] "${parent.parentTitle}" — ${lineAnalysis.shouldSplit ? 'SPLIT' : 'FOLD'} [${lineAnalysis.method}], splitDim=${splitDim}, keep=${keepDim}${reclassNote}`);
    for (const [val, vars] of lineAnalysis.groups) {
      console.log(`    "${val}": ${vars.length} variations`);
    }
  }

  // Base action fields shared by fold and split
  const baseFields = {
    parentId: parent.parentId,
    parentTitle: parent.parentTitle,
    parentSlug: parent.parentSlug,
    isLubricant: parent.isLubricant,
    splitDimension: splitDim,
    keepDimension: keepDim,
    reclassifyKeptFrom,
    reclassifyKeptTo,
    newTermsNeeded: [] as string[],
  };

  if (!lineAnalysis.shouldSplit) {
    return {
      ...baseFields,
      type: 'fold',
      reason: `[${lineAnalysis.method}] All variations belong together — fold ${splitDim}, keep ${finalAttr}`,
    };
  }

  // Build split plan from the groups determined by SKU/price analysis
  const skuLookup = await getSkuLookup();
  const sortedGroups = [...lineAnalysis.groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const groupPlans: SplitGroupPlan[] = [];

  for (let i = 0; i < sortedGroups.length; i++) {
    const [groupLabel, vars] = sortedGroups[i];
    const isKeep = i === 0; // Largest group keeps original parent

    // Determine the split value for this group (the split dim value most common in this group)
    const splitMetaKey = `attribute_${splitDim}`;
    const splitValCounts = new Map<string, number>();
    for (const v of vars) {
      const sv = v.attrs.get(splitMetaKey) || '_unset_';
      splitValCounts.set(sv, (splitValCounts.get(sv) || 0) + 1);
    }
    const primarySplitVal = [...splitValCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Generate title
    let title: string;
    // Try feed-based title
    const feedNames: string[] = [];
    for (const v of vars) {
      const feedKey = v.warehouseSku || v.sku;
      if (feedKey) {
        const feed = skuLookup.get(feedKey);
        if (feed?.name) feedNames.push(feed.name);
      }
    }

    if (feedNames.length >= 2) {
      const cp = longestCommonPrefix(feedNames).replace(/[\s,\-–]+$/, '').trim();
      if (cp.length >= 5) {
        title = cp;
      } else {
        title = generateSplitTitle(parent.parentTitle, primarySplitVal, splitDim);
      }
    } else if (feedNames.length === 1) {
      // Single feed name — strip the variant suffix
      title = feedNames[0];
    } else {
      title = generateSplitTitle(parent.parentTitle, primarySplitVal, splitDim);
    }

    if (isKeep) {
      // For keep group, prefer the parent title with split value appended
      title = generateSplitTitle(parent.parentTitle, primarySplitVal, splitDim);
    }

    groupPlans.push({
      label: groupLabel,
      splitValue: primarySplitVal,
      variationIds: vars.map(v => v.id),
      newParentTitle: title,
      newParentSlug: toSlug(title),
      isKeepGroup: isKeep,
    });
  }

  return {
    ...baseFields,
    type: 'split',
    groups: groupPlans,
    reason: `[${lineAnalysis.method}] ${sortedGroups.length} product lines — split into ${sortedGroups.length} products, keep ${finalAttr}${reclassifyKeptTo ? ` (reclassify ${keepDim})` : ''}`,
  };
}

function generateSplitTitle(parentTitle: string, splitVal: string, splitDim: string): string {
  if (splitVal === '_unset_') return parentTitle;

  // Format the value nicely
  const formattedVal = splitVal
    .replace(/-/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Check if the value already appears in the title
  if (parentTitle.toLowerCase().includes(splitVal.toLowerCase()) ||
      parentTitle.toLowerCase().includes(formattedVal.toLowerCase())) {
    return parentTitle;
  }

  return `${parentTitle} - ${formattedVal}`;
}

function planReclassifyAction(parent: MisclassifiedParent): EnforceAction {
  const newTermsNeeded: string[] = [];

  // Normalize values based on target taxonomy
  for (const val of parent.attrValues) {
    if (parent.reclassifyTo === 'pa_color') {
      const normalized = normalizeColor(val.replace(/-/g, ' '));
      newTermsNeeded.push(toSlug(normalized));
    } else if (parent.reclassifyTo === 'pa_size') {
      const normalized = normalizeSize(val.replace(/-/g, ' '));
      newTermsNeeded.push(toSlug(normalized));
    } else {
      // pa_variant — keep slug as-is (formula/type names)
      newTermsNeeded.push(toSlug(val.replace(/-/g, ' ')));
    }
  }

  return {
    type: 'reclassify',
    parentId: parent.parentId,
    parentTitle: parent.parentTitle,
    parentSlug: parent.parentSlug,
    isLubricant: parent.isLubricant,
    reclassifyFrom: parent.currentAttr,
    reclassifyTo: parent.reclassifyTo,
    newTermsNeeded,
    reason: `${parent.currentAttr} not allowed for ${parent.isLubricant ? 'lubricant' : 'non-lubricant'} — reclassify to ${parent.reclassifyTo}`,
  };
}

// ==================== PHASE 4: EXECUTION ====================

async function ensureTermExists(
  db: Connection, taxonomy: string, slug: string, name: string
): Promise<number> {
  // Check if term+taxonomy combination exists
  const [existing] = await db.query<RowDataPacket[]>(
    `SELECT t.term_id FROM wp_terms t
     JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
     WHERE t.slug = ? AND tt.taxonomy = ?`,
    [slug, taxonomy]
  );

  if (existing.length > 0) return existing[0].term_id;

  // Check if term exists (might be in different taxonomy)
  const [termRows] = await db.query<RowDataPacket[]>(
    `SELECT term_id FROM wp_terms WHERE slug = ?`, [slug]
  );

  let termId: number;
  if (termRows.length > 0) {
    termId = termRows[0].term_id;
  } else {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
      [name, slug]
    );
    termId = result.insertId;
  }

  // Create term_taxonomy entry
  await db.query(
    `INSERT IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
     VALUES (?, ?, '', 0, 0)`,
    [termId, taxonomy]
  );

  return termId;
}

/**
 * Reclassify the kept dimension on a parent and its variations.
 * Called after split/fold when the kept dimension isn't in the allowed set.
 * Runs WITHIN the caller's transaction (no begin/commit here).
 */
async function reclassifyKeptDimension(
  db: Connection, parentId: number, fromAttr: string, toAttr: string
): Promise<string[]> {
  const oldMetaKey = `attribute_${fromAttr}`;
  const newMetaKey = `attribute_${toAttr}`;
  const newTermsCreated: string[] = [];

  // Get variations and their current values
  const [varRows] = await db.query<RowDataPacket[]>(
    `SELECT v.ID as id, pm.meta_value as old_value
     FROM wp_posts v
     JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key = ?
     WHERE v.post_parent = ? AND v.post_type = 'product_variation'`,
    [oldMetaKey, parentId]
  );

  for (const v of varRows) {
    const oldSlug = (v.old_value || '').trim();
    if (!oldSlug) continue;

    let normalizedName: string;
    let normalizedSlug: string;
    if (toAttr === 'pa_color') {
      normalizedName = normalizeColor(oldSlug.replace(/-/g, ' '));
      normalizedSlug = toSlug(normalizedName);
    } else if (toAttr === 'pa_size') {
      normalizedName = normalizeSize(oldSlug.replace(/-/g, ' '));
      normalizedSlug = toSlug(normalizedName);
    } else {
      normalizedName = oldSlug.replace(/-/g, ' ').split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      normalizedSlug = toSlug(normalizedName);
    }

    const termId = await ensureTermExists(db, toAttr, normalizedSlug, normalizedName);
    if (!newTermsCreated.includes(normalizedSlug)) newTermsCreated.push(normalizedSlug);

    // Delete old, insert new
    await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [v.id, oldMetaKey]);
    await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
      [v.id, newMetaKey, normalizedSlug]);
  }

  // Update _product_attributes on parent
  const [attrMeta] = await db.query<RowDataPacket[]>(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
    [parentId]
  );
  if (attrMeta.length > 0 && attrMeta[0].meta_value) {
    const attrs = deserializePhpArray(attrMeta[0].meta_value);
    const newAttrs: Record<string, any> = {};
    const TAXONOMY_NAMES: Record<string, string> = {
      'pa_color': 'Color', 'pa_size': 'Size', 'pa_variant': 'Variant',
      'pa_style': 'Style', 'pa_flavor': 'Flavor',
    };

    for (const [key, val] of Object.entries(attrs)) {
      if (key === fromAttr) {
        newAttrs[toAttr] = {
          name: TAXONOMY_NAMES[toAttr] || toAttr.replace('pa_', ''),
          value: '', position: (val as any).position || 0,
          is_visible: 1, is_variation: 1, is_taxonomy: 1,
        };
      } else {
        newAttrs[key] = val;
      }
    }
    await db.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
      [serializePhpArray(newAttrs), parentId]
    );
  }

  // Remove old taxonomy term relationships from parent
  const [oldTermTaxIds] = await db.query<RowDataPacket[]>(
    `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt WHERE tt.taxonomy = ?`, [fromAttr]
  );
  if (oldTermTaxIds.length > 0) {
    const oldTaxIds = oldTermTaxIds.map(r => r.term_taxonomy_id);
    await db.query(
      `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id IN (${oldTaxIds.join(',')})`,
      [parentId]
    );
  }

  // Add new taxonomy terms to parent
  for (const slug of newTermsCreated) {
    const [termTax] = await db.query<RowDataPacket[]>(
      `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
       JOIN wp_terms t ON t.term_id = tt.term_id
       WHERE t.slug = ? AND tt.taxonomy = ?`, [slug, toAttr]
    );
    if (termTax.length > 0) {
      await db.query(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
        [parentId, termTax[0].term_taxonomy_id]
      );
    }
  }

  // Update _default_attributes
  const [firstVar] = await db.query<RowDataPacket[]>(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
    [varRows[0]?.id, newMetaKey]
  );
  if (firstVar?.length > 0) {
    const defaults: Record<string, string> = {};
    defaults[toAttr] = firstVar[0].meta_value || '';
    await db.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
      [serializePhpArray(defaults), parentId]
    );
  }

  return newTermsCreated;
}

async function executeSplitAction(
  db: Connection, action: EnforceAction, opts: ScriptOptions
): Promise<{ success: boolean; newParentIds: number[]; error?: string }> {
  if (!action.groups || action.groups.length < 2) {
    return { success: false, newParentIds: [], error: 'No groups to split' };
  }

  await db.beginTransaction();

  try {
    const { parentId, splitDimension, keepDimension } = action;
    const splitMetaKey = `attribute_${splitDimension}`;
    const keepMetaKey = `attribute_${keepDimension}`;
    const newParentIds: number[] = [];

    // Load original parent post
    const [parentRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM wp_posts WHERE ID = ?`, [parentId]
    );
    if (parentRows.length === 0) throw new Error(`Parent post ${parentId} not found`);
    const parent = parentRows[0];

    // Load parent meta
    const [metaRows] = await db.query<RowDataPacket[]>(
      `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ?`, [parentId]
    );

    // Load taxonomy relationships
    const [termRels] = await db.query<RowDataPacket[]>(
      `SELECT term_taxonomy_id, term_order FROM wp_term_relationships WHERE object_id = ?`,
      [parentId]
    );

    // Find term_taxonomy_ids for the split dimension (to remove from new parents)
    const [splitTermTaxIds] = await db.query<RowDataPacket[]>(
      `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt WHERE tt.taxonomy = ?`,
      [splitDimension]
    );
    const splitTaxIds = new Set(splitTermTaxIds.map(r => r.term_taxonomy_id));

    const SKIP_META_KEYS = new Set([
      '_sku', '_price', '_regular_price', '_sale_price',
      '_default_attributes', '_children',
      '_thumbnail_id', '_product_image_gallery',
    ]);

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const keepGroup = action.groups!.find(g => g.isKeepGroup)!;
    const newGroups = action.groups!.filter(g => !g.isKeepGroup);

    // Build updated _product_attributes (remove split dimension, keep only keepDimension)
    const existingAttrs = action.groups ? deserializePhpArray(
      metaRows.find(m => m.meta_key === '_product_attributes')?.meta_value || ''
    ) : {};

    const newProductAttrs: Record<string, any> = {};
    // Only keep the keepDimension and any non-variation attributes
    for (const [key, val] of Object.entries(existingAttrs)) {
      const attrObj = val as any;
      if (key === keepDimension) {
        newProductAttrs[key] = { ...attrObj, is_variation: 1 };
      } else if (key !== splitDimension && attrObj.is_variation !== 1) {
        // Keep non-variation attributes (like brand display)
        newProductAttrs[key] = attrObj;
      }
      // Skip splitDimension and any OTHER variation attributes
    }

    // Also remove any extra pa_ variation attributes beyond keepDimension
    const extraAttrKeys = Object.keys(existingAttrs).filter(k =>
      k !== keepDimension && k !== splitDimension &&
      k.startsWith('pa_') && (existingAttrs[k] as any).is_variation === 1
    );

    const serializedNewAttrs = serializePhpArray(newProductAttrs);

    // Process each new group (non-keep)
    for (const newGroup of newGroups) {
      const finalSlug = await ensureUniqueSlug(db, toSlug(newGroup.newParentTitle), parentId);

      const [insertResult] = await db.query<ResultSetHeader>(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type,
          post_mime_type, comment_count
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, 0, '', 0, 'product',
          '', 0
        )`,
        [
          parent.post_author, parent.post_date, parent.post_date_gmt,
          parent.post_content, newGroup.newParentTitle,
          parent.post_excerpt, parent.post_status, parent.comment_status,
          parent.ping_status, parent.post_password,
          finalSlug, parent.to_ping || '', parent.pinged || '',
          now, now, parent.post_content_filtered || '',
        ]
      );
      const newParentId = insertResult.insertId;
      newParentIds.push(newParentId);

      await db.query(
        `UPDATE wp_posts SET guid = CONCAT('https://wp.maleq.com/?post_type=product&p=', ID) WHERE ID = ?`,
        [newParentId]
      );

      if (opts.verbose) {
        console.log(`    Created new parent ${newParentId} ("${newGroup.newParentTitle}") for ${newGroup.variationIds.length} variations`);
      }

      // Copy parent meta (skip certain keys)
      for (const meta of metaRows) {
        if (SKIP_META_KEYS.has(meta.meta_key)) continue;
        if (meta.meta_key === '_product_attributes') {
          // Use the cleaned attributes (without split dimension)
          await db.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
            [newParentId, serializedNewAttrs]
          );
          continue;
        }
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [newParentId, meta.meta_key, meta.meta_value]
        );
      }

      // Set images from variation thumbnails
      const [varThumbRows] = await db.query<RowDataPacket[]>(
        `SELECT post_id, meta_value FROM wp_postmeta
         WHERE post_id IN (${newGroup.variationIds.join(',')}) AND meta_key = '_thumbnail_id'
           AND meta_value IS NOT NULL AND meta_value != '' AND meta_value != '0'
         ORDER BY post_id`
      );
      const varThumbs = varThumbRows.map(r => r.meta_value).filter(Boolean);
      if (varThumbs.length > 0) {
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
          [newParentId, varThumbs[0]]
        );
        const uniqueThumbs = [...new Set(varThumbs)];
        if (uniqueThumbs.length > 1) {
          await db.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
            [newParentId, uniqueThumbs.slice(1).join(',')]
          );
        }
      } else {
        const origThumb = metaRows.find(m => m.meta_key === '_thumbnail_id');
        const origGallery = metaRows.find(m => m.meta_key === '_product_image_gallery');
        if (origThumb) {
          await db.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
            [newParentId, origThumb.meta_value]
          );
        }
        if (origGallery) {
          await db.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
            [newParentId, origGallery.meta_value]
          );
        }
      }

      // Calculate prices
      const groupPrices = await getVariationPrices(db, newGroup.variationIds);
      const minPrice = groupPrices.length > 0 ? Math.min(...groupPrices) : 0;
      const maxPrice = groupPrices.length > 0 ? Math.max(...groupPrices) : 0;

      const newSku = `ENFORCE-${newParentId}`;
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_sku', ?)`,
        [newParentId, newSku]
      );
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_price', ?)`,
        [newParentId, String(minPrice)]
      );

      // Set default attributes from first variation (keepDimension only)
      const firstVarId = newGroup.variationIds[0];
      const [firstVarAttrs] = await db.query<RowDataPacket[]>(
        `SELECT meta_key, meta_value FROM wp_postmeta
         WHERE post_id = ? AND meta_key = ?`,
        [firstVarId, keepMetaKey]
      );
      if (firstVarAttrs.length > 0) {
        const defaults: Record<string, string> = {};
        defaults[keepDimension!] = firstVarAttrs[0].meta_value || '';
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_default_attributes', ?)`,
          [newParentId, serializePhpArray(defaults)]
        );
      }

      // Copy taxonomy relationships (excluding split dimension terms)
      for (const rel of termRels) {
        if (splitTaxIds.has(rel.term_taxonomy_id)) continue;
        await db.query(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, ?)`,
          [newParentId, rel.term_taxonomy_id, rel.term_order]
        );
        await db.query(
          `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
          [rel.term_taxonomy_id]
        );
      }

      // Move variations to new parent
      for (const varId of newGroup.variationIds) {
        await db.query(`UPDATE wp_posts SET post_parent = ? WHERE ID = ?`, [newParentId, varId]);
      }

      // Remove split dimension attribute from moved variations
      await db.query(
        `DELETE FROM wp_postmeta WHERE post_id IN (${newGroup.variationIds.join(',')}) AND meta_key = ?`,
        [splitMetaKey]
      );

      // Remove extra pa_ variation attributes from moved variations
      for (const extraKey of extraAttrKeys) {
        await db.query(
          `DELETE FROM wp_postmeta WHERE post_id IN (${newGroup.variationIds.join(',')}) AND meta_key = ?`,
          [`attribute_${extraKey}`]
        );
      }

      // Create wp_wc_product_meta_lookup
      const [onsaleRows] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM wp_postmeta
         WHERE post_id IN (${newGroup.variationIds.join(',')})
           AND meta_key = '_sale_price' AND meta_value != '' AND meta_value != '0'`
      );
      const onsale = (onsaleRows[0]?.cnt || 0) > 0 ? 1 : 0;

      await db.query(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales, tax_status, tax_class
        ) VALUES (?, ?, 0, 0, ?, ?, ?, 0, 'instock', 0, 0, 0, 'taxable', '')`,
        [newParentId, newSku, minPrice, maxPrice, onsale]
      );
    }

    // Update KEEP group on original parent
    const keepIds = keepGroup.variationIds;

    // Update original parent title if needed
    if (keepGroup.newParentTitle !== parent.post_title) {
      const newSlug = await ensureUniqueSlug(db, toSlug(keepGroup.newParentTitle), parentId);
      await db.query(
        `UPDATE wp_posts SET post_title = ?, post_name = ?, post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
        [keepGroup.newParentTitle, newSlug, now, now, parentId]
      );
    }

    // Update _product_attributes on original parent
    await db.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
      [serializedNewAttrs, parentId]
    );

    // Remove split dimension from keep group variations
    await db.query(
      `DELETE FROM wp_postmeta WHERE post_id IN (${keepIds.join(',')}) AND meta_key = ?`,
      [splitMetaKey]
    );

    // Remove extra variation attributes from keep group
    for (const extraKey of extraAttrKeys) {
      await db.query(
        `DELETE FROM wp_postmeta WHERE post_id IN (${keepIds.join(',')}) AND meta_key = ?`,
        [`attribute_${extraKey}`]
      );
    }

    // Remove split dimension term relationships from original parent
    if (splitTaxIds.size > 0) {
      await db.query(
        `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id IN (${[...splitTaxIds].join(',')})`,
        [parentId]
      );
    }

    // Update default attributes on original parent
    const firstKeepVarId = keepIds[0];
    const [firstKeepAttrs] = await db.query<RowDataPacket[]>(
      `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
      [firstKeepVarId, keepMetaKey]
    );
    if (firstKeepAttrs.length > 0) {
      const defaults: Record<string, string> = {};
      defaults[keepDimension!] = firstKeepAttrs[0].meta_value || '';
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
        [serializePhpArray(defaults), parentId]
      );
    }

    // Update pricing on original parent
    if (keepIds.length > 0) {
      const remainPrices = await getVariationPrices(db, keepIds);
      const remainMin = remainPrices.length > 0 ? Math.min(...remainPrices) : 0;
      const remainMax = remainPrices.length > 0 ? Math.max(...remainPrices) : 0;

      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
        [String(remainMin), parentId]
      );

      const [origOnsaleRows] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM wp_postmeta
         WHERE post_id IN (${keepIds.join(',')})
           AND meta_key = '_sale_price' AND meta_value != '' AND meta_value != '0'`
      );
      const origOnsale = (origOnsaleRows[0]?.cnt || 0) > 0 ? 1 : 0;

      await db.query(
        `UPDATE wp_wc_product_meta_lookup SET min_price = ?, max_price = ?, onsale = ? WHERE product_id = ?`,
        [remainMin, remainMax, origOnsale, parentId]
      );
    }

    // Post-split reclassification of kept dimension if needed
    if (action.reclassifyKeptFrom && action.reclassifyKeptTo) {
      const allParentIds = [parentId!, ...newParentIds];
      for (const pid of allParentIds) {
        await reclassifyKeptDimension(db, pid, action.reclassifyKeptFrom, action.reclassifyKeptTo);
      }
    }

    await db.commit();
    return { success: true, newParentIds };

  } catch (err: any) {
    await db.rollback();
    return { success: false, newParentIds: [], error: err.message };
  }
}

async function executeFoldAction(
  db: Connection, action: EnforceAction, opts: ScriptOptions
): Promise<{ success: boolean; error?: string }> {
  await db.beginTransaction();

  try {
    const { parentId, splitDimension, keepDimension } = action;
    const splitMetaKey = `attribute_${splitDimension}`;

    // Get all variation IDs for this parent
    const [varRows] = await db.query<RowDataPacket[]>(
      `SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation'`,
      [parentId]
    );
    const varIds = varRows.map(r => r.ID);

    if (varIds.length === 0) {
      await db.commit();
      return { success: true };
    }

    // Remove split dimension from all variations
    await db.query(
      `DELETE FROM wp_postmeta WHERE post_id IN (${varIds.join(',')}) AND meta_key = ?`,
      [splitMetaKey]
    );

    // Remove any other extra variation attributes (keep only keepDimension)
    const keepMetaKey = `attribute_${keepDimension}`;
    const [extraAttrs] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT meta_key FROM wp_postmeta
       WHERE post_id IN (${varIds.join(',')})
         AND meta_key LIKE 'attribute_pa_%'
         AND meta_key != ?`,
      [keepMetaKey]
    );
    for (const extra of extraAttrs) {
      await db.query(
        `DELETE FROM wp_postmeta WHERE post_id IN (${varIds.join(',')}) AND meta_key = ?`,
        [extra.meta_key]
      );
    }

    // Update _product_attributes
    const [attrMeta] = await db.query<RowDataPacket[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
      [parentId]
    );
    if (attrMeta.length > 0 && attrMeta[0].meta_value) {
      const attrs = deserializePhpArray(attrMeta[0].meta_value);
      const newAttrs: Record<string, any> = {};
      for (const [key, val] of Object.entries(attrs)) {
        if (key === keepDimension) {
          newAttrs[key] = { ...val as any, is_variation: 1 };
        } else if (!(val as any).is_variation) {
          newAttrs[key] = val;
        }
      }
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [serializePhpArray(newAttrs), parentId]
      );
    }

    // Remove split dimension term relationships
    const [splitTermTaxIds] = await db.query<RowDataPacket[]>(
      `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt WHERE tt.taxonomy = ?`,
      [splitDimension]
    );
    if (splitTermTaxIds.length > 0) {
      const taxIds = splitTermTaxIds.map(r => r.term_taxonomy_id);
      await db.query(
        `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id IN (${taxIds.join(',')})`,
        [parentId]
      );
    }

    // Update _default_attributes
    const firstVarId = varIds[0];
    const [firstVarAttrs] = await db.query<RowDataPacket[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
      [firstVarId, keepMetaKey]
    );
    if (firstVarAttrs.length > 0) {
      const defaults: Record<string, string> = {};
      defaults[keepDimension!] = firstVarAttrs[0].meta_value || '';
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
        [serializePhpArray(defaults), parentId]
      );
    }

    // Post-fold reclassification of kept dimension if needed
    if (action.reclassifyKeptFrom && action.reclassifyKeptTo) {
      await reclassifyKeptDimension(db, parentId!, action.reclassifyKeptFrom, action.reclassifyKeptTo);
    }

    await db.commit();
    return { success: true };

  } catch (err: any) {
    await db.rollback();
    return { success: false, error: err.message };
  }
}

async function executeReclassifyAction(
  db: Connection, action: EnforceAction, opts: ScriptOptions
): Promise<{ success: boolean; newTermsCreated: string[]; error?: string }> {
  await db.beginTransaction();
  const newTermsCreated: string[] = [];

  try {
    const { parentId, reclassifyFrom, reclassifyTo } = action;
    const oldMetaKey = `attribute_${reclassifyFrom}`;
    const newMetaKey = `attribute_${reclassifyTo}`;

    // Get all variation IDs and their current pa_variant values
    const [varRows] = await db.query<RowDataPacket[]>(
      `SELECT v.ID as id, pm.meta_value as old_value
       FROM wp_posts v
       JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key = ?
       WHERE v.post_parent = ? AND v.post_type = 'product_variation'`,
      [oldMetaKey, parentId]
    );

    if (varRows.length === 0) {
      await db.commit();
      return { success: true, newTermsCreated };
    }

    // For each variation, rename the attribute meta key and normalize the value
    for (const v of varRows) {
      const oldSlug = (v.old_value || '').trim();
      if (!oldSlug) continue;

      // Normalize the value
      let normalizedName: string;
      let normalizedSlug: string;
      if (reclassifyTo === 'pa_color') {
        normalizedName = normalizeColor(oldSlug.replace(/-/g, ' '));
        normalizedSlug = toSlug(normalizedName);
      } else if (reclassifyTo === 'pa_size') {
        normalizedName = normalizeSize(oldSlug.replace(/-/g, ' '));
        normalizedSlug = toSlug(normalizedName);
      } else {
        // pa_variant — title case the slug
        normalizedName = oldSlug.replace(/-/g, ' ').split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        normalizedSlug = toSlug(normalizedName);
      }

      // Ensure term exists in target taxonomy
      const termId = await ensureTermExists(db, reclassifyTo!, normalizedSlug, normalizedName);
      if (!newTermsCreated.includes(normalizedSlug)) {
        newTermsCreated.push(normalizedSlug);
      }

      // Delete old meta, insert new
      await db.query(
        `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
        [v.id, oldMetaKey]
      );
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [v.id, newMetaKey, normalizedSlug]
      );
    }

    // Update parent _product_attributes
    const [attrMeta] = await db.query<RowDataPacket[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes'`,
      [parentId]
    );

    if (attrMeta.length > 0 && attrMeta[0].meta_value) {
      const attrs = deserializePhpArray(attrMeta[0].meta_value);
      const newAttrs: Record<string, any> = {};

      for (const [key, val] of Object.entries(attrs)) {
        if (key === reclassifyFrom) {
          // Replace with new taxonomy
          const TAXONOMY_NAMES: Record<string, string> = {
            'pa_color': 'Color', 'pa_size': 'Size', 'pa_variant': 'Variant',
            'pa_style': 'Style', 'pa_flavor': 'Flavor',
          };
          const attrName = TAXONOMY_NAMES[reclassifyTo!] || reclassifyTo!.replace('pa_', '');
          newAttrs[reclassifyTo!] = {
            name: attrName,
            value: '',
            position: (val as any).position || 0,
            is_visible: 1,
            is_variation: 1,
            is_taxonomy: 1,
          };
        } else {
          newAttrs[key] = val;
        }
      }

      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [serializePhpArray(newAttrs), parentId]
      );
    }

    // Update parent term relationships
    // Remove old pa_variant terms
    const [oldTermTaxIds] = await db.query<RowDataPacket[]>(
      `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt WHERE tt.taxonomy = ?`,
      [reclassifyFrom]
    );
    if (oldTermTaxIds.length > 0) {
      const oldTaxIds = oldTermTaxIds.map(r => r.term_taxonomy_id);
      await db.query(
        `DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id IN (${oldTaxIds.join(',')})`,
        [parentId]
      );
    }

    // Add new taxonomy terms to parent
    for (const slug of newTermsCreated) {
      const [termTax] = await db.query<RowDataPacket[]>(
        `SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
         JOIN wp_terms t ON t.term_id = tt.term_id
         WHERE t.slug = ? AND tt.taxonomy = ?`,
        [slug, reclassifyTo]
      );
      if (termTax.length > 0) {
        await db.query(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [parentId, termTax[0].term_taxonomy_id]
        );
      }
    }

    // Update _default_attributes
    const firstVarId = varRows[0].id;
    const [firstNewAttr] = await db.query<RowDataPacket[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
      [firstVarId, newMetaKey]
    );
    if (firstNewAttr.length > 0) {
      const defaults: Record<string, string> = {};
      defaults[reclassifyTo!] = firstNewAttr[0].meta_value || '';
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
        [serializePhpArray(defaults), parentId]
      );
    }

    await db.commit();
    return { success: true, newTermsCreated };

  } catch (err: any) {
    await db.rollback();
    return { success: false, newTermsCreated, error: err.message };
  }
}

// ==================== OUTPUT ====================

function printSummary(report: EnforceReport) {
  const s = report.summary;
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Multi-attribute parents:       ${s.totalMultiAttrParents}`);
  console.log(`  Misclassified single-attr:     ${s.totalMisclassifiedParents}`);
  console.log(`  Splits planned:                ${s.totalSplits}`);
  console.log(`  Folds planned:                 ${s.totalFolds}`);
  console.log(`  Reclassifications planned:     ${s.totalReclassifications}`);
  console.log(`  New parents to create:         ${s.totalNewParentsToCreate}`);
  console.log(`  New terms to create:           ${s.totalNewTermsCreated}`);
  console.log(`  Total variations affected:     ${s.totalVariationsAffected}`);

  if (report.skipped.length > 0) {
    console.log(`\n  Skipped: ${report.skipped.length}`);
    for (const skip of report.skipped.slice(0, 10)) {
      console.log(`    [${skip.parentId}] "${skip.parentTitle}" — ${skip.reason}`);
    }
    if (report.skipped.length > 10) {
      console.log(`    ... and ${report.skipped.length - 10} more`);
    }
  }
}

function printSampleActions(report: EnforceReport, maxSamples = 30) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ACTIONS (first ${Math.min(maxSamples, report.actions.length)} of ${report.actions.length})`);
  console.log('='.repeat(70));

  for (let i = 0; i < Math.min(maxSamples, report.actions.length); i++) {
    const action = report.actions[i];
    console.log(`\n  [${action.parentId}] "${action.parentTitle}" — ${action.type.toUpperCase()}`);
    console.log(`    ${action.reason}`);

    if (action.type === 'split' && action.groups) {
      for (const g of action.groups) {
        const marker = g.isKeepGroup ? 'KEEP' : 'NEW';
        console.log(`    [${marker}] "${g.newParentTitle}" (${g.variationIds.length} vars, ${action.splitDimension}="${g.splitValue}")`);
      }
      if (action.reclassifyKeptTo) {
        console.log(`    Post-split: ${action.reclassifyKeptFrom} -> ${action.reclassifyKeptTo}`);
      }
    }

    if (action.type === 'fold') {
      if (action.reclassifyKeptTo) {
        console.log(`    Post-fold: ${action.reclassifyKeptFrom} -> ${action.reclassifyKeptTo}`);
      }
    }

    if (action.type === 'reclassify') {
      console.log(`    ${action.reclassifyFrom} -> ${action.reclassifyTo}`);
    }

    if (action.newTermsNeeded.length > 0) {
      console.log(`    New terms: ${action.newTermsNeeded.slice(0, 10).join(', ')}${action.newTermsNeeded.length > 10 ? '...' : ''}`);
    }
  }
}

function saveReport(report: EnforceReport, outputPath: string) {
  const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report written to: ${outputPath}`);
}

// ==================== MAIN ====================

async function main() {
  const opts = parseArgs();

  console.log(`\nEnforce Single Variation Attribute - Mode: ${opts.mode.toUpperCase()}`);
  console.log('='.repeat(70));

  const db = await getConnection();

  try {
    // Phase 1: Discovery
    const multiAttrParents = await findMultiAttrParents(db, opts);
    const multiAttrIds = new Set(multiAttrParents.map(p => p.parentId));
    const misclassified = await findMisclassifiedVariants(db, opts, multiAttrIds);

    if (multiAttrParents.length === 0 && misclassified.length === 0) {
      console.log('\nNo products need enforcement. All good!');
      return;
    }

    // Phase 2-3: Analysis & Planning
    // Pre-load feed data so SKU/barcode lookups are available during planning
    await buildSkuLookup();

    console.log('\n--- Phase 2: Planning actions ---');

    const report: EnforceReport = {
      timestamp: new Date().toISOString(),
      summary: {
        totalMultiAttrParents: multiAttrParents.length,
        totalMisclassifiedParents: misclassified.length,
        totalSplits: 0,
        totalFolds: 0,
        totalReclassifications: 0,
        totalNewParentsToCreate: 0,
        totalNewTermsCreated: 0,
        totalVariationsAffected: 0,
      },
      actions: [],
      skipped: [],
    };

    // Plan multi-attr actions
    for (const parent of multiAttrParents) {
      const action = await planMultiAttrAction(db, parent, opts);
      if (action) {
        report.actions.push(action);
        if (action.type === 'split') {
          report.summary.totalSplits++;
          const newGroups = action.groups?.filter(g => !g.isKeepGroup) || [];
          report.summary.totalNewParentsToCreate += newGroups.length;
          report.summary.totalVariationsAffected += (action.groups || []).reduce(
            (sum, g) => sum + g.variationIds.length, 0
          );
        } else if (action.type === 'fold') {
          report.summary.totalFolds++;
          report.summary.totalVariationsAffected += parent.variations.length;
        }
      } else {
        report.skipped.push({
          parentId: parent.parentId,
          parentTitle: parent.parentTitle,
          reason: 'Could not determine split/fold strategy',
        });
      }
    }

    // Plan reclassify actions
    for (const parent of misclassified) {
      const action = planReclassifyAction(parent);
      report.actions.push(action);
      report.summary.totalReclassifications++;
      report.summary.totalVariationsAffected += parent.variations.length;
      report.summary.totalNewTermsCreated += action.newTermsNeeded.length;
    }

    // Output
    printSummary(report);
    printSampleActions(report);

    const outputPath = opts.output.startsWith('/')
      ? opts.output
      : `${BASE_DIR}/${opts.output}`;
    saveReport(report, outputPath);

    // Dry-run: show SQL
    if (opts.mode === 'dry-run') {
      console.log(`\n${'='.repeat(70)}`);
      console.log('DRY RUN - PLANNED OPERATIONS');
      console.log('='.repeat(70));

      for (const action of report.actions) {
        console.log(`\n-- ${action.type.toUpperCase()}: [${action.parentId}] "${action.parentTitle}"`);

        if (action.type === 'split' && action.groups) {
          const keepGroup = action.groups.find(g => g.isKeepGroup);
          const newGroups = action.groups.filter(g => !g.isKeepGroup);
          console.log(`-- Split by ${action.splitDimension}, keep ${action.keepDimension}`);
          console.log(`-- Keep group: ${keepGroup?.variationIds.length} vars -> "${keepGroup?.newParentTitle}"`);
          for (const ng of newGroups) {
            console.log(`-- New parent: "${ng.newParentTitle}" (${ng.variationIds.length} vars)`);
            console.log(`INSERT INTO wp_posts (...) -- clone parent ${action.parentId}`);
            for (const varId of ng.variationIds) {
              console.log(`UPDATE wp_posts SET post_parent = NEW_ID WHERE ID = ${varId};`);
            }
            console.log(`DELETE FROM wp_postmeta WHERE post_id IN (${ng.variationIds.join(',')}) AND meta_key = 'attribute_${action.splitDimension}';`);
          }
          if (keepGroup) {
            console.log(`DELETE FROM wp_postmeta WHERE post_id IN (${keepGroup.variationIds.join(',')}) AND meta_key = 'attribute_${action.splitDimension}';`);
          }
        }

        if (action.type === 'fold') {
          console.log(`-- Remove ${action.splitDimension} from all variations, keep ${action.keepDimension}`);
          console.log(`DELETE FROM wp_postmeta WHERE post_id IN (variation_ids) AND meta_key = 'attribute_${action.splitDimension}';`);
          console.log(`UPDATE wp_postmeta SET meta_value = '...' WHERE post_id = ${action.parentId} AND meta_key = '_product_attributes';`);
          if (action.reclassifyKeptTo) {
            console.log(`-- Then reclassify ${action.reclassifyKeptFrom} -> ${action.reclassifyKeptTo} on parent ${action.parentId}`);
          }
        }

        if (action.type === 'reclassify') {
          console.log(`-- Reclassify ${action.reclassifyFrom} -> ${action.reclassifyTo}`);
          console.log(`-- For each variation: DELETE attribute_${action.reclassifyFrom}, INSERT attribute_${action.reclassifyTo}`);
          console.log(`UPDATE wp_postmeta SET meta_value = '...' WHERE post_id = ${action.parentId} AND meta_key = '_product_attributes';`);
        }
      }
    }

    // Apply
    if (opts.mode === 'apply') {
      console.log(`\n${'='.repeat(70)}`);
      console.log('APPLYING CHANGES');
      console.log('='.repeat(70));

      let successes = 0;
      let failures = 0;
      let totalNewTerms = 0;

      for (const action of report.actions) {
        process.stdout.write(
          `  ${action.type.toUpperCase()} [${action.parentId}] "${action.parentTitle}"... `
        );

        if (action.type === 'split') {
          const result = await executeSplitAction(db, action, opts);
          if (result.success) {
            console.log(`OK (new IDs: ${result.newParentIds.join(', ')})`);
            successes++;
          } else {
            console.log(`FAILED: ${result.error}`);
            failures++;
          }
        } else if (action.type === 'fold') {
          const result = await executeFoldAction(db, action, opts);
          if (result.success) {
            console.log('OK');
            successes++;
          } else {
            console.log(`FAILED: ${result.error}`);
            failures++;
          }
        } else if (action.type === 'reclassify') {
          const result = await executeReclassifyAction(db, action, opts);
          if (result.success) {
            console.log(`OK (terms: ${result.newTermsCreated.length})`);
            successes++;
            totalNewTerms += result.newTermsCreated.length;
          } else {
            console.log(`FAILED: ${result.error}`);
            failures++;
          }
        }
      }

      console.log(`\n  Done: ${successes} successful, ${failures} failed`);
      if (totalNewTerms > 0) {
        console.log(`  New attribute terms created: ${totalNewTerms}`);
      }
      console.log(`\n  REMINDER: Run WP-CLI to regenerate lookup tables:`);
      console.log(`    wc tool run regenerate_product_attributes_lookup_table`);
      console.log(`    wc tool run regenerate_product_lookup_tables`);
      console.log(`    transient delete --all`);
    }

  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
