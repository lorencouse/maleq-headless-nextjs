#!/usr/bin/env bun

/**
 * Split Variable Products with Mixed Product Lines (V2.2 — SKU + Price)
 *
 * Uses warehouse SKU prefix grouping (`_wt_sku`) as the primary method to
 * identify distinct product lines merged under one WooCommerce variable parent.
 * Refines with price-based grouping: same price = same product line (color variants),
 * different price = different size/volume (separate products).
 * Falls back to keyword-based splitting for non-Williams products.
 *
 * Supports N-way splits (a parent with 7 SKU prefix groups → 7 products).
 *
 * Usage:
 *   bun scripts/split-variation-products.ts [mode] [options]
 *
 * Modes:
 *   --analyze         Analyze and report (default). Writes JSON report.
 *   --dry-run         Show exact SQL that would run
 *   --apply           Execute splits in a transaction
 *
 * Options:
 *   --local           Connect to local DB (default is remote via SSH tunnel)
 *   --output <file>   JSON report path (default: scripts/output/split-report.json)
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
  source: 'williams-active' | 'williams-inactive' | 'stc';
}

interface ScriptOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  output: string;
  limit?: number;
  parentId?: number;
  verbose: boolean;
}

interface VariationData {
  id: number;
  parentId: number;
  title: string;
  slug: string;
  excerpt: string;
  status: string;
  sku: string;          // _sku (barcode/UPC)
  warehouseSku: string; // _wt_sku (Williams warehouse SKU)
  feedName: string;     // from feed lookup by warehouseSku
  regularPrice: number; // _regular_price for price-based grouping
}

/** A group of variations sharing the same SKU prefix or keyword match */
interface SplitGroup {
  label: string;         // Human-readable label for this group
  variationIds: number[];
  skuPrefix?: string;    // SKU prefix if SKU-based
  keyword?: string;      // Keyword if keyword-based
}

type SplitMethod = 'sku-prefix' | 'sku-prefix+price' | 'price' | 'keyword';

interface SplitCandidate {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  totalVariations: number;
  method: SplitMethod;
  groups: SplitGroup[];          // All groups (first = stays on original parent)
  variations: VariationData[];
}

interface SplitAction {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  method: SplitMethod;
  /** The group that stays on the original parent (largest group) */
  keepGroup: {
    label: string;
    variationIds: number[];
    skuPrefix?: string;
  };
  /** Groups that each get a new parent product */
  newGroups: Array<{
    label: string;
    variationIds: number[];
    skuPrefix?: string;
    newParentTitle: string;
    newParentSlug: string;
    hasDuplicateAttrs: boolean;
  }>;
  keepGroupHasDuplicateAttrs: boolean;
}

interface SplitReport {
  timestamp: string;
  summary: {
    totalParentsScanned: number;
    totalSplitCandidates: number;
    totalVariationsAffected: number;
    totalNewParentsToCreate: number;
    totalWithDuplicateAttrs: number;
    splitsByMethod: Record<string, number>;
  };
  actions: SplitAction[];
  skipped: Array<{
    parentId: number;
    parentTitle: string;
    reason: string;
  }>;
}

interface SnapshotVariation {
  id: number;
  sku: string;
  warehouseSku: string;
  price: string;
  sizeAttr: string;
  feedName: string;
  status: string;
}

interface SnapshotEntry {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  method: SplitMethod;
  newParents: Array<{
    id: number;
    title: string;
    slug: string;
    variationCount: number;
    minPrice: string;
    maxPrice: string;
    movedVariations: SnapshotVariation[];
  }>;
  originalParentAfter: {
    id: number;
    title: string;
    variationCount: number;
    minPrice: string;
    maxPrice: string;
    remainingVariations: SnapshotVariation[];
  } | null;
  before: {
    variations: SnapshotVariation[];
  };
  success: boolean;
  error?: string;
}

interface SplitLog {
  timestamp: string;
  mode: string;
  entries: SnapshotEntry[];
}

// ==================== ARGUMENT PARSING ====================

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const opts: ScriptOptions = {
    mode: 'analyze',
    output: 'scripts/output/split-report.json',
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
      case '--local':
      case '--remote':
        break;
      case '--db':
        i++;
        break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Split Variable Products (V2 — SKU-First Approach)
===================================================
Uses warehouse SKU prefix grouping as the primary method to split variable
products that contain multiple product lines. Falls back to keyword-based
splitting for non-Williams products.

Supports N-way splits (one parent can become 2, 3, or 7+ products).

Usage: bun scripts/split-variation-products.ts [mode] [options]

Modes:
  --analyze     Analyze and write JSON report (default)
  --dry-run     Show exact SQL that would be executed
  --apply       Execute splits in a database transaction

Options:
  --local       Connect to local DB (via socket)
  --output <f>  JSON report path (default: scripts/output/split-report.json)
  --limit <n>   Limit number of parent products to process
  --parent <id> Only process a specific parent product ID
  --verbose     Print extra debug info
  --help, -h    Show this help
`);
}

// ==================== FEED PARSING (LAZY) ====================

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';

const WILLIAMS_XML_FILES = [
  `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
];

const STC_CSV_FILE = `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`;

let _skuLookupCache: Map<string, FeedProduct> | null = null;
/** Maps barcode (UPC) → warehouse SKU for resolving DB _sku → _wt_sku */
let _barcodeToWtSkuCache: Map<string, string> | null = null;
/** Set of all STC barcodes/UPCs — used for discontinued product detection */
let _stcBarcodeSetCache: Set<string> | null = null;

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

async function getStcBarcodeSet(): Promise<Set<string>> {
  if (_stcBarcodeSetCache) return _stcBarcodeSetCache;
  await buildSkuLookup();
  return _stcBarcodeSetCache!;
}

async function parseWilliamsXml(
  filePath: string,
  skuMap: Map<string, FeedProduct>,
  barcodeMap: Map<string, string>,
  sourceTag: 'williams-active' | 'williams-inactive' = 'williams-active'
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
        currentProduct = { source: sourceTag };
        buffer = line + '\n';
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

async function parseStcCsv(
  filePath: string,
  skuMap: Map<string, FeedProduct>,
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

      if (handle && !skuMap.has(handle)) {
        skuMap.set(handle, product);
        count++;
      }
      if (upc && !skuMap.has(upc)) {
        skuMap.set(upc, { ...product, sku: upc });
      }
      // STC: UPC → handle mapping (handle is used as SKU in DB for STC products)
      if (upc && handle && !barcodeMap.has(upc)) {
        barcodeMap.set(upc, handle);
      }
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}

async function buildSkuLookup(): Promise<Map<string, FeedProduct>> {
  console.log('\n--- Building SKU lookup from product feeds (lazy) ---');
  const skuMap = new Map<string, FeedProduct>();
  const barcodeMap = new Map<string, string>();
  const stcBarcodes = new Set<string>();

  // Parse active Williams XML first (takes priority)
  const activeCount = await parseWilliamsXml(WILLIAMS_XML_FILES[0], skuMap, barcodeMap, 'williams-active');
  console.log(`    -> Added ${activeCount.toLocaleString()} active Williams products`);

  // Parse inactive Williams XML
  if (WILLIAMS_XML_FILES.length > 1) {
    const inactiveCount = await parseWilliamsXml(WILLIAMS_XML_FILES[1], skuMap, barcodeMap, 'williams-inactive');
    console.log(`    -> Added ${inactiveCount.toLocaleString()} inactive Williams products`);
  }

  const stcCount = await parseStcCsv(STC_CSV_FILE, skuMap, barcodeMap);
  console.log(`    -> Added ${stcCount.toLocaleString()} STC products`);

  // Build STC barcode set for discontinued detection
  for (const [key, product] of skuMap) {
    if (product.source === 'stc' && product.barcode) {
      stcBarcodes.add(product.barcode);
    }
  }
  console.log(`  STC barcodes for discontinued detection: ${stcBarcodes.size.toLocaleString()}`);

  console.log(`  Total SKU lookup entries: ${skuMap.size.toLocaleString()}`);
  console.log(`  Total barcode→warehouseSku mappings: ${barcodeMap.size.toLocaleString()}`);

  _skuLookupCache = skuMap;
  _barcodeToWtSkuCache = barcodeMap;
  _stcBarcodeSetCache = stcBarcodes;
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
      if (str[pos] === 'b') {
        pos++; pos++;
        const val = str[pos] === '1';
        pos++; pos++;
        return val;
      }
      if (str[pos] === 'N') {
        pos++; pos++;
        return null;
      }
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
  } catch {
    return {};
  }
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
        if (/^\d+$/.test(k)) {
          inner += `i:${parseInt(k, 10)};`;
        } else {
          inner += `s:${k.length}:"${k}";`;
        }
        inner += ser(v);
      }
      return `a:${entries.length}:{${inner}}`;
    }
    const s = String(val);
    return `s:${s.length}:"${s}";`;
  }
  return ser(obj);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

// ==================== SKU PREFIX EXTRACTION ====================

/**
 * Extract the prefix from a warehouse SKU for grouping product lines.
 *
 * Strategy: find the non-numeric prefix (letters + separators), then keep
 * a fixed portion of the numeric suffix to distinguish product lines while
 * stripping the variant digits (color/size codes).
 *
 * SKUs follow patterns like:
 *   SNSL1, SNSL16, SNSL32       → prefix "SNSL"  (all Swiss Navy Silicone Lube sizes)
 *   BN12050, BN12051, BN12052   → prefix "BN120"  (Sweet N Hard 6 in Pink/Purple/Blue)
 *   BN16420, BN16421, BN16422   → prefix "BN164"  (Sweet N Hard 1 in colors)
 *   CNVEF-4390, CNVEF-4391      → prefix "CNVEF-43" (same line, color variants)
 *
 * Algorithm:
 * 1. Split SKU into alpha-prefix (with separators) and numeric-suffix.
 * 2. If numeric suffix is 1-2 digits → prefix = alpha part only (size/color code).
 * 3. If numeric suffix is 3+ digits → prefix = alpha part + all but last 2 digits.
 *    This keeps the product-line digits while stripping the variant digits.
 */
function extractSkuPrefix(sku: string): string {
  if (!sku || sku.length < 3) return sku;

  // Find where the trailing numeric portion starts
  // Walk backwards past digits to find the boundary
  let numStart = sku.length;
  for (let i = sku.length - 1; i >= 0; i--) {
    if (/\d/.test(sku[i])) {
      numStart = i;
    } else {
      break;
    }
  }

  // No trailing digits → return as-is
  if (numStart === sku.length) return sku;

  const alphaPart = sku.substring(0, numStart); // e.g., "SNSL", "BN", "CNVEF-"
  const numPart = sku.substring(numStart);       // e.g., "1", "16", "12050"

  // If alpha part is empty (pure numeric SKU), fall back to stripping last 2
  if (!alphaPart) {
    return numPart.length > 2 ? sku.substring(0, sku.length - 2) : sku;
  }

  // Short numeric suffix (1-2 digits): these ARE the variant (size/color).
  // The product line is fully identified by the alpha prefix.
  // e.g., SNSL1, SNSL16, SNSL32 → all "SNSL"
  if (numPart.length <= 2) {
    return alphaPart;
  }

  // Longer numeric suffix (3+ digits): keep all but last 2 digits as product-line ID.
  // e.g., BN12050 → "BN" + "120" = "BN120"
  //        CNVEF-4390 → "CNVEF-" + "43" = "CNVEF-43"
  const keepDigits = numPart.substring(0, numPart.length - 2);
  return alphaPart + keepDigits;
}

// ==================== KEYWORD-BASED SPLIT SIGNALS (FALLBACK) ====================

const SPLIT_SIGNALS: Record<string, { patterns: RegExp[]; label: string }> = {
  'vibrating':        { patterns: [/\bvibrating\b/i],                                    label: 'Vibrating' },
  'rechargeable':     { patterns: [/\brechargeable\b/i],                                 label: 'Rechargeable' },
  'silicone-material':{ patterns: [/\bsilicone\b/i],                                     label: 'Silicone' },
  'water-based':      { patterns: [/\bwater[- ]?based\b/i, /\bh2o\b/i],                  label: 'H2O' },
  'with-balls':       { patterns: [/\bw\/?\.?\s*balls\b/i, /\bwith balls\b/i],           label: 'With Balls' },
  'suction-cup':      { patterns: [/\bsuction[- ]?cup\b/i, /\bw\/?\.?\s*suction\b/i],    label: 'Suction Cup' },
  'warming':          { patterns: [/\bwarming\b/i],                                      label: 'Warming' },
  'cooling':          { patterns: [/\bcooling\b/i, /\btingling\b/i],                     label: 'Cooling' },
  'curved':           { patterns: [/\bcurved\b/i],                                       label: 'Curved' },
  'double':           { patterns: [/\bdouble\b/i],                                       label: 'Double' },
};

const PRODUCT_NOUNS = /\b(lubricant|lube|dildo|dong|vibrator|plug|vibe|massager|ring|sleeve|stroker|pump|cock|penis|strap-on|harness|stimulator|wand|bullet|egg|beads|probe|kit|set|cream|gel|oil|spray|wash|cleanser|enhancer)\b/i;

function generateKeywordSplitTitle(parentTitle: string, label: string): string {
  if (new RegExp(`\\b${escapeRegex(label)}\\b`, 'i').test(parentTitle)) {
    return parentTitle;
  }

  const words = parentTitle.split(/\s+/);
  let insertIndex = words.length;

  for (let i = words.length - 1; i >= 0; i--) {
    if (PRODUCT_NOUNS.test(words[i].replace(/[^a-zA-Z-]/g, ''))) {
      insertIndex = i;
      break;
    }
  }

  if (insertIndex === 0) {
    insertIndex = words.length;
  }

  words.splice(insertIndex, 0, label);
  return words.join(' ');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== DATABASE QUERIES ====================

async function loadVariableParents(
  db: Connection,
  opts: ScriptOptions
): Promise<Array<{ id: number; title: string; slug: string; varCount: number }>> {
  let query = `
    SELECT p.ID as id, p.post_title as title, p.post_name as slug, COUNT(v.ID) as var_count
    FROM wp_posts p
    JOIN wp_posts v ON v.post_parent = p.ID AND v.post_type = 'product_variation'
    WHERE p.post_type = 'product' AND p.post_status = 'publish'
  `;
  const params: (string | number)[] = [];

  if (opts.parentId) {
    query += ` AND p.ID = ?`;
    params.push(opts.parentId);
  }

  query += ` GROUP BY p.ID HAVING var_count >= 3 ORDER BY var_count DESC`;

  if (opts.limit) {
    query += ` LIMIT ?`;
    params.push(opts.limit);
  }

  const [rows] = await db.query<RowDataPacket[]>(query, params);
  return rows as any[];
}

/**
 * Load variations with both _sku and _wt_sku for all given parent IDs.
 */
async function loadVariationsWithSkus(
  db: Connection,
  parentIds: number[]
): Promise<Map<number, VariationData[]>> {
  if (parentIds.length === 0) return new Map();

  const [varRows] = await db.query<RowDataPacket[]>(`
    SELECT v.ID as id, v.post_parent as parentId, v.post_title as title,
           v.post_name as slug, LEFT(v.post_excerpt, 500) as excerpt,
           v.post_status as status
    FROM wp_posts v
    WHERE v.post_type = 'product_variation'
      AND v.post_parent IN (${parentIds.join(',')})
    ORDER BY v.post_parent, v.ID
  `);

  const varIds = varRows.map(v => v.id);
  if (varIds.length === 0) return new Map();

  // Batch-load _sku and _wt_sku
  const [metaRows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_key, meta_value
    FROM wp_postmeta
    WHERE post_id IN (${varIds.join(',')})
      AND meta_key IN ('_sku', '_wt_sku', '_regular_price')
      AND meta_value IS NOT NULL AND meta_value != ''
  `);

  const skuById = new Map<number, string>();
  const wtSkuById = new Map<number, string>();
  const priceById = new Map<number, number>();
  for (const r of metaRows) {
    if (r.meta_key === '_sku') skuById.set(r.post_id, r.meta_value);
    if (r.meta_key === '_wt_sku') wtSkuById.set(r.post_id, r.meta_value);
    if (r.meta_key === '_regular_price') {
      const p = parseFloat(r.meta_value);
      if (p > 0 && isFinite(p)) priceById.set(r.post_id, p);
    }
  }

  // Fallback: resolve missing _wt_sku from barcode via feed (for the ~47 unresolvable variations)
  let barcodeMap: Map<string, string> | null = null;
  const missingWtSku = varRows.filter(v => !wtSkuById.has(v.id) && skuById.has(v.id));
  if (missingWtSku.length > 0) {
    barcodeMap = await getBarcodeToWtSku();
  }

  const result = new Map<number, VariationData[]>();
  for (const v of varRows) {
    let warehouseSku = wtSkuById.get(v.id) || '';

    // Fallback: resolve from barcode for variations without _wt_sku in DB
    if (!warehouseSku && barcodeMap) {
      const barcode = skuById.get(v.id) || '';
      if (barcode) {
        warehouseSku = barcodeMap.get(barcode) || '';
      }
    }

    const varData: VariationData = {
      id: v.id,
      parentId: v.parentId,
      title: v.title,
      slug: v.slug,
      excerpt: v.excerpt || '',
      status: v.status,
      sku: skuById.get(v.id) || '',
      warehouseSku,
      feedName: '', // populated lazily
      regularPrice: priceById.get(v.id) || 0,
    };

    if (!result.has(v.parentId)) result.set(v.parentId, []);
    result.get(v.parentId)!.push(varData);
  }

  return result;
}

// ==================== ADAPTIVE SKU SUB-SPLITTING ====================

/**
 * For groups with mixed prices (multiple price tiers with 2+ items each),
 * try progressively longer SKU prefixes (strip fewer trailing digits) to find
 * sub-groups where each sub-group has uniform prices.
 *
 * E.g., NSN096110, NSN096111 ($10) and NSN096120, NSN096121 ($15):
 * - Default extractSkuPrefix strips 2 digits: NSN0961 (all grouped together, mixed prices)
 * - Strip 1 digit: NSN09611 ($10) vs NSN09612 ($15) → uniform price sub-groups!
 */
function adaptiveSkuSubSplit(
  groups: Map<string, VariationData[]>,
  opts: ScriptOptions
): void {
  const toReplace = new Map<string, Map<string, VariationData[]>>();

  for (const [prefix, members] of groups) {
    // Check if this group has mixed prices with multiple price tiers of 2+ items
    const priceGroups = new Map<number, number>();
    for (const v of members) {
      if (v.regularPrice > 0) {
        priceGroups.set(v.regularPrice, (priceGroups.get(v.regularPrice) || 0) + 1);
      }
    }
    const multiItemTiers = [...priceGroups.values()].filter(c => c >= 2).length;
    if (multiItemTiers < 2) continue; // Not mixed enough to sub-split

    // Get the original warehouse SKUs and figure out the current strip length
    const skus = members.map(v => v.warehouseSku);
    const originalPrefix = prefix.replace(/~$/, '');

    // Try progressively longer prefixes (strip fewer digits)
    let bestSubGroups: Map<string, VariationData[]> | null = null;
    let bestScore = 0;

    for (let extraChars = 1; extraChars <= 3; extraChars++) {
      const tryLen = originalPrefix.length + extraChars;
      const subGroups = new Map<string, VariationData[]>();

      for (const v of members) {
        const subPrefix = v.warehouseSku.substring(0, Math.min(tryLen, v.warehouseSku.length));
        if (!subGroups.has(subPrefix)) subGroups.set(subPrefix, []);
        subGroups.get(subPrefix)!.push(v);
      }

      // Score: count sub-groups with 2+ members that have uniform price
      let uniformCount = 0;
      let totalInUniform = 0;
      for (const subMembers of subGroups.values()) {
        if (subMembers.length < 2) continue;
        const prices = new Set(subMembers.filter(v => v.regularPrice > 0).map(v => v.regularPrice));
        if (prices.size === 1) {
          uniformCount++;
          totalInUniform += subMembers.length;
        }
      }

      // We want at least 2 uniform sub-groups to justify splitting
      if (uniformCount >= 2 && totalInUniform > bestScore) {
        bestScore = totalInUniform;
        bestSubGroups = subGroups;
      }
    }

    if (bestSubGroups && bestSubGroups.size >= 2) {
      toReplace.set(prefix, bestSubGroups);
      if (opts.verbose) {
        const subInfo = [...bestSubGroups.entries()]
          .map(([p, vs]) => {
            const prices = [...new Set(vs.map(v => v.regularPrice))];
            return `${p}(${vs.length}@$${prices.join('/$')})`;
          }).join(', ');
        console.log(`    Adaptive sub-split ${prefix}(${members.length}) → ${subInfo}`);
      }
    }
  }

  // Apply replacements
  for (const [oldPrefix, subGroups] of toReplace) {
    groups.delete(oldPrefix);
    for (const [newPrefix, members] of subGroups) {
      if (members.length >= 2) {
        groups.set(newPrefix, members);
      } else {
        // Absorb singletons into largest remaining group
        let largest = '';
        let largestSize = 0;
        for (const [k, v] of groups) {
          if (v.length > largestSize) { largestSize = v.length; largest = k; }
        }
        if (largest) groups.get(largest)!.push(...members);
      }
    }
  }
}

// ==================== SKU PREFIX GROUPING (PRIMARY METHOD) ====================

/**
 * Group variations by warehouse SKU prefix.
 * Returns null if no meaningful split is found.
 */
function groupBySkuPrefix(
  variations: VariationData[],
  opts: ScriptOptions
): Map<string, VariationData[]> | null {
  const withSku = variations.filter(v => v.warehouseSku);

  // Need at least 60% of variations to have _wt_sku for this method to apply
  if (withSku.length < variations.length * 0.6) return null;
  if (withSku.length < 3) return null;

  // Group by prefix
  const groups = new Map<string, VariationData[]>();
  for (const v of withSku) {
    const prefix = extractSkuPrefix(v.warehouseSku);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(v);
  }

  if (opts.verbose) {
    console.log(`    SKU prefixes: ${[...groups.entries()].map(([p, vs]) => `${p}(${vs.length})`).join(', ')}`);
  }

  // Filter: only keep groups with 2+ members
  const validGroups = new Map<string, VariationData[]>();
  const singletons: VariationData[] = [];

  for (const [prefix, members] of groups) {
    if (members.length >= 2) {
      validGroups.set(prefix, members);
    } else {
      singletons.push(...members);
    }
  }

  // Try to re-group singletons using progressively shorter prefixes.
  // e.g., PD5401, PD5402, PD5403 → all share "PD54" at a shorter level.
  // Find the truncation length that maximizes the number of clustered vars.
  if (singletons.length >= 2) {
    const singletonPrefixes = singletons.map(v => extractSkuPrefix(v.warehouseSku));
    const maxLen = Math.max(...singletonPrefixes.map(p => p.length));

    // Evaluate all lengths, pick the best (most vars in clusters of 2+)
    let bestLen = -1;
    let bestClusterVars = 0;
    let bestSingletonCount = singletons.length;

    for (let tryLen = maxLen - 1; tryLen >= 2; tryLen--) {
      const shortGroups = new Map<string, number>(); // prefix → count
      for (let i = 0; i < singletons.length; i++) {
        const shortPrefix = singletonPrefixes[i].substring(0, tryLen);
        shortGroups.set(shortPrefix, (shortGroups.get(shortPrefix) || 0) + 1);
      }

      let clusterVars = 0;
      let singletonCount = 0;
      for (const cnt of shortGroups.values()) {
        if (cnt >= 2) clusterVars += cnt;
        else singletonCount += cnt;
      }

      if (clusterVars > bestClusterVars ||
          (clusterVars === bestClusterVars && singletonCount < bestSingletonCount)) {
        bestClusterVars = clusterVars;
        bestSingletonCount = singletonCount;
        bestLen = tryLen;
      }
    }

    if (bestLen > 0 && bestClusterVars >= 2) {
      // Apply the best length
      const shortGroups = new Map<string, VariationData[]>();
      for (let i = 0; i < singletons.length; i++) {
        const shortPrefix = singletonPrefixes[i].substring(0, bestLen);
        if (!shortGroups.has(shortPrefix)) shortGroups.set(shortPrefix, []);
        shortGroups.get(shortPrefix)!.push(singletons[i]);
      }

      const remainingSingletons: VariationData[] = [];
      for (const [shortPrefix, members] of shortGroups) {
        if (members.length >= 2) {
          const groupKey = `${shortPrefix}~`;
          validGroups.set(groupKey, members);
        } else {
          remainingSingletons.push(...members);
        }
      }
      singletons.length = 0;
      singletons.push(...remainingSingletons);

      if (opts.verbose) {
        const newKeys = [...validGroups.keys()].filter(k => k.endsWith('~'));
        if (newKeys.length > 0) {
          console.log(`    Re-grouped singletons (len=${bestLen}): ${newKeys.map(k => `${k}(${validGroups.get(k)!.length})`).join(', ')}`);
        }
      }
    }
  }

  // Any remaining true singletons stay on the largest valid group
  if (singletons.length > 0 && validGroups.size > 0) {
    let largestPrefix = '';
    let largestSize = 0;
    for (const [prefix, members] of validGroups) {
      if (members.length > largestSize) {
        largestSize = members.length;
        largestPrefix = prefix;
      }
    }
    if (largestPrefix) {
      validGroups.get(largestPrefix)!.push(...singletons);
    }
  }

  // Adaptive sub-splitting: for groups with mixed prices, try longer prefixes
  // to produce sub-groups with uniform prices (different sizes → separate groups)
  adaptiveSkuSubSplit(validGroups, opts);

  // If only 1 valid group after regrouping, no split needed
  if (validGroups.size <= 1) return null;

  // Handle variations without _wt_sku — keep them on the largest group
  const withoutSku = variations.filter(v => !v.warehouseSku);
  if (withoutSku.length > 0) {
    let largestPrefix = '';
    let largestSize = 0;
    for (const [prefix, members] of validGroups) {
      if (members.length > largestSize) {
        largestSize = members.length;
        largestPrefix = prefix;
      }
    }
    if (largestPrefix) {
      validGroups.get(largestPrefix)!.push(...withoutSku);
    }
  }

  return validGroups;
}

// ==================== PRICE-BASED REFINEMENT ====================

/**
 * Refine SKU prefix groups using price as a signal.
 *
 * Rule: "Same price = same product line (color variants). Different price = different size/volume."
 *
 * Two cases:
 * 1. Groups have mixed prices internally → same product in different colors was
 *    grouped by color (SKU prefix). Re-group by price to get size-based products.
 *    Only do this if all groups share the same product name prefix (i.e., they're
 *    actually the same product, not different scents/styles).
 * 2. Uniform-price groups share the same price → merge (e.g., "7in clear" + "7in regular"
 *    at same price are one product with color selector).
 */
function refineGroupsByPrice(
  groups: Map<string, VariationData[]>,
  opts: ScriptOptions
): Map<string, VariationData[]> {
  // Step 1: Check for mixed prices within groups
  let anyMixed = false;
  for (const vars of groups.values()) {
    const prices = new Set(vars.filter(v => v.regularPrice > 0).map(v => v.regularPrice));
    if (prices.size > 1) { anyMixed = true; break; }
  }

  if (!anyMixed) {
    // No mixed prices within groups → try merging uniform-price groups
    return mergeUniformPriceGroups(groups, opts);
  }

  // Step 2: Check if groups represent the same product line
  // by comparing common prefix of feed names across groups.
  // If groups have DIFFERENT product name prefixes (e.g., different scents),
  // don't re-group by price — the mixed prices are just size variations within each scent.
  const groupCommonPrefixes: string[] = [];
  for (const vars of groups.values()) {
    const feedNames = vars.map(v => v.feedName).filter(Boolean);
    if (feedNames.length >= 2) {
      const cp = longestCommonPrefix(feedNames).replace(/[\s,\-–]+$/, '').trim();
      if (cp.length >= 5) groupCommonPrefixes.push(cp.toLowerCase());
    }
  }

  if (groupCommonPrefixes.length >= 2) {
    const uniquePrefixes = new Set(groupCommonPrefixes);
    if (uniquePrefixes.size > 1) {
      // Different product lines → don't re-group everything by price.
      // But still try to redistribute the keep group's mixed-price variations
      // to matching new groups (e.g., beige 6" → "KING COCK 6 IN" group).
      if (opts.verbose) {
        console.log(`    Price: groups have different product names → trying redistribution`);
      }
      return redistributeKeepByPrice(groups, opts);
    }
  }

  // Step 3: Same product line (or can't determine) → re-group all variations by price
  const allVars: VariationData[] = [];
  for (const vars of groups.values()) allVars.push(...vars);

  const byPrice = new Map<number, VariationData[]>();
  const unknownPrice: VariationData[] = [];

  for (const v of allVars) {
    if (v.regularPrice > 0) {
      if (!byPrice.has(v.regularPrice)) byPrice.set(v.regularPrice, []);
      byPrice.get(v.regularPrice)!.push(v);
    } else {
      unknownPrice.push(v);
    }
  }

  const validGroups = [...byPrice.entries()].filter(([_, vars]) => vars.length >= 2);
  if (validGroups.length < 2) return groups; // Price grouping doesn't produce a meaningful split

  const result = new Map<string, VariationData[]>();
  const singletons: VariationData[] = [...unknownPrice];

  for (const [price, vars] of byPrice) {
    if (vars.length >= 2) {
      result.set(`price-${price}`, vars);
    } else {
      singletons.push(...vars);
    }
  }

  // Absorb singletons into largest group
  if (singletons.length > 0 && result.size > 0) {
    let largest = '';
    let largestSize = 0;
    for (const [key, vars] of result) {
      if (vars.length > largestSize) { largestSize = vars.length; largest = key; }
    }
    if (largest) result.get(largest)!.push(...singletons);
  }

  if (opts.verbose) {
    console.log(`    Price refinement: ${groups.size} SKU groups → ${result.size} price groups`);
  }

  return result;
}

/**
 * Merge uniform-price SKU prefix groups that share the same price.
 * Only merges if the combined variations have a meaningful shared product name prefix
 * (>= 3 words), to avoid merging different product types that happen to cost the same.
 */
function mergeUniformPriceGroups(
  groups: Map<string, VariationData[]>,
  opts: ScriptOptions
): Map<string, VariationData[]> {
  // Build price → group keys mapping
  const priceToKeys = new Map<number, string[]>();
  for (const [key, vars] of groups) {
    const prices = [...new Set(vars.filter(v => v.regularPrice > 0).map(v => v.regularPrice))];
    if (prices.length === 1) {
      const p = prices[0];
      if (!priceToKeys.has(p)) priceToKeys.set(p, []);
      priceToKeys.get(p)!.push(key);
    }
  }

  // Check if any price has multiple groups
  let anyMergeable = false;
  for (const keys of priceToKeys.values()) {
    if (keys.length >= 2) { anyMergeable = true; break; }
  }
  if (!anyMergeable) return groups;

  const result = new Map<string, VariationData[]>();
  const consumed = new Set<string>();

  for (const [price, keys] of priceToKeys) {
    if (keys.length < 2) continue;

    // Validate merge: merged variations must share a meaningful common product name
    const allVars: VariationData[] = [];
    for (const key of keys) allVars.push(...groups.get(key)!);

    const feedNames = allVars.map(v => v.feedName).filter(Boolean);
    if (feedNames.length < 2) continue;

    const cp = longestCommonPrefix(feedNames).replace(/[\s,\-–]+$/, '').trim();
    const wordCount = cp.split(/\s+/).length;

    if (wordCount < 3) continue; // Common prefix too short → probably different products

    // Merge!
    result.set(`price-${price}`, allVars);
    for (const key of keys) consumed.add(key);

    if (opts.verbose) {
      console.log(`    Price merge ${keys.length} groups at $${price}: "${cp}" (${allVars.length} vars)`);
    }
  }

  // Keep non-merged groups
  for (const [key, vars] of groups) {
    if (!consumed.has(key)) result.set(key, vars);
  }

  return result;
}

/**
 * Redistribute variations from the keep group (largest group) to matching
 * new groups based on price. Useful when the keep group accumulated mixed
 * variations (e.g., different sizes in one color) that belong with existing
 * size-specific groups.
 *
 * For each keep-group variation, if a non-keep group has the same price,
 * move the variation there. Variations that don't match any group's price
 * stay in the keep group.
 */
function redistributeKeepByPrice(
  groups: Map<string, VariationData[]>,
  opts: ScriptOptions
): Map<string, VariationData[]> {
  // Find the largest group (would-be keep group)
  let keepKey = '';
  let keepSize = 0;
  for (const [key, vars] of groups) {
    if (vars.length > keepSize) { keepSize = vars.length; keepKey = key; }
  }

  const keepVars = groups.get(keepKey)!;

  // Check if keep group has mixed prices
  const keepPrices = new Set(keepVars.filter(v => v.regularPrice > 0).map(v => v.regularPrice));
  if (keepPrices.size <= 1) return groups; // Uniform → no redistribution needed

  // Build price → target group key mapping from non-keep groups
  // For each non-keep group, determine its "representative" price (most common price in the group)
  const priceToGroupKey = new Map<number, string>();
  for (const [key, vars] of groups) {
    if (key === keepKey) continue;
    const priceFreq = new Map<number, number>();
    for (const v of vars) {
      if (v.regularPrice > 0) priceFreq.set(v.regularPrice, (priceFreq.get(v.regularPrice) || 0) + 1);
    }
    // Use most common price as representative
    let bestPrice = 0;
    let bestCount = 0;
    for (const [p, cnt] of priceFreq) {
      if (cnt > bestCount) { bestCount = cnt; bestPrice = p; }
    }
    if (bestPrice > 0 && !priceToGroupKey.has(bestPrice)) {
      priceToGroupKey.set(bestPrice, key);
    }
  }

  if (priceToGroupKey.size === 0) return groups;

  // Redistribute
  const result = new Map<string, VariationData[]>();
  for (const [key, vars] of groups) {
    result.set(key, key === keepKey ? [] : [...vars]);
  }

  const remaining: VariationData[] = [];
  let moved = 0;

  for (const v of keepVars) {
    const targetKey = priceToGroupKey.get(v.regularPrice);
    if (targetKey && result.has(targetKey)) {
      result.get(targetKey)!.push(v);
      moved++;
    } else {
      remaining.push(v);
    }
  }

  if (moved === 0) return groups; // Nothing redistributed

  // Put remaining variations back in keep group
  if (remaining.length > 0) {
    result.set(keepKey, remaining);
  } else {
    result.delete(keepKey);
  }

  // If redistribution left us with < 2 groups, revert
  if (result.size < 2) return groups;

  if (opts.verbose) {
    console.log(`    Price redistribution: moved ${moved} vars from keep → matching groups (${remaining.length} remaining in keep)`);
  }

  return result;
}

/**
 * Standalone price-based grouping for products without SKU data.
 * Groups variations by regularPrice — each price tier = one product.
 */
function groupByPrice(
  variations: VariationData[],
  opts: ScriptOptions
): Map<string, VariationData[]> | null {
  const byPrice = new Map<number, VariationData[]>();
  const unknownPrice: VariationData[] = [];

  for (const v of variations) {
    if (v.regularPrice > 0) {
      if (!byPrice.has(v.regularPrice)) byPrice.set(v.regularPrice, []);
      byPrice.get(v.regularPrice)!.push(v);
    } else {
      unknownPrice.push(v);
    }
  }

  const validGroups = [...byPrice.entries()].filter(([_, vars]) => vars.length >= 2);
  if (validGroups.length < 2) return null;

  const result = new Map<string, VariationData[]>();
  const singletons: VariationData[] = [...unknownPrice];

  for (const [price, vars] of byPrice) {
    if (vars.length >= 2) {
      result.set(`price-${price}`, vars);
    } else {
      singletons.push(...vars);
    }
  }

  // Absorb singletons into largest group
  if (singletons.length > 0 && result.size > 0) {
    let largest = '';
    let largestSize = 0;
    for (const [key, vars] of result) {
      if (vars.length > largestSize) { largestSize = vars.length; largest = key; }
    }
    if (largest) result.get(largest)!.push(...singletons);
  }

  if (opts.verbose) {
    console.log(`    Price-only grouping: ${result.size} price groups`);
  }

  return result;
}

// ==================== KEYWORD-BASED SPLIT (FALLBACK) ====================

interface KeywordSplitResult {
  keyword: string;
  label: string;
  withIds: number[];
  withoutIds: number[];
}

function detectKeywordSplit(
  parentTitle: string,
  variations: VariationData[]
): KeywordSplitResult | null {
  let bestResult: KeywordSplitResult | null = null;
  let bestRatio = Infinity;

  for (const [keyword, { patterns, label }] of Object.entries(SPLIT_SIGNALS)) {
    const inParentTitle = patterns.some(pat => pat.test(parentTitle));
    if (inParentTitle) continue;

    const withIds: number[] = [];
    const withoutIds: number[] = [];

    for (const v of variations) {
      const searchText = v.feedName || `${v.title} ${v.excerpt}`;
      if (patterns.some(pat => pat.test(searchText))) {
        withIds.push(v.id);
      } else {
        withoutIds.push(v.id);
      }
    }

    if (withIds.length >= 2 && withoutIds.length >= 2) {
      const ratio = Math.abs(withIds.length - withoutIds.length) / variations.length;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestResult = { keyword, label, withIds, withoutIds };
      }
    }
  }

  return bestResult;
}

// ==================== TITLE GENERATION ====================

/**
 * Derive a title for a SKU-prefix group using feed product names.
 * Finds the longest common prefix among feed names in the group.
 */
async function deriveGroupTitle(
  group: VariationData[],
  skuPrefix: string,
  parentTitle: string
): Promise<string> {
  const skuLookup = await getSkuLookup();

  // Collect feed names for variations in this group
  const feedNames: string[] = [];
  for (const v of group) {
    if (v.warehouseSku) {
      const feed = skuLookup.get(v.warehouseSku);
      if (feed?.name) feedNames.push(feed.name);
    }
  }

  if (feedNames.length >= 2) {
    const commonPrefix = longestCommonPrefix(feedNames);
    // Clean up: remove trailing whitespace, hyphens, commas
    const cleaned = commonPrefix.replace(/[\s,\-–]+$/, '').trim();
    if (cleaned.length >= 5) {
      return cleaned;
    }
  }

  // Fallback: try variation titles
  const titles = group.map(v => v.title).filter(Boolean);
  if (titles.length >= 2) {
    const commonPrefix = longestCommonPrefix(titles);
    const cleaned = commonPrefix.replace(/[\s,\-–]+$/, '').trim();
    if (cleaned.length >= 5 && cleaned !== parentTitle) {
      return cleaned;
    }
  }

  // Last fallback: parent title + prefix/price identifier
  if (skuPrefix.startsWith('price-')) {
    const priceVal = skuPrefix.replace('price-', '$');
    return `${parentTitle} (${priceVal})`;
  }
  return `${parentTitle} (${skuPrefix})`;
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  // Word-level common prefix to avoid cutting mid-word
  const wordArrays = strings.map(s => s.split(/\s+/));
  const minLen = Math.min(...wordArrays.map(w => w.length));
  const commonWords: string[] = [];

  for (let i = 0; i < minLen; i++) {
    const word = wordArrays[0][i];
    if (wordArrays.every(wa => wa[i].toLowerCase() === word.toLowerCase())) {
      commonWords.push(word);
    } else {
      break;
    }
  }

  return commonWords.join(' ');
}

// ==================== DISCONTINUED DETECTION ====================

/**
 * Mark variations as discontinued (post_status = 'private') if their source
 * product is ONLY in inactive_products.xml and their barcode is NOT in the STC feed.
 * This means the item was discontinued by Williams and not available from STC either.
 */
async function markDiscontinuedVariations(
  db: Connection,
  action: SplitAction,
  opts: ScriptOptions
): Promise<number> {
  const skuLookup = await getSkuLookup();
  const stcBarcodes = await getStcBarcodeSet();
  // Collect all variation IDs in this split
  const allVarIds = [...action.keepGroup.variationIds];
  for (const ng of action.newGroups) allVarIds.push(...ng.variationIds);

  if (allVarIds.length === 0) return 0;

  // Load _sku (barcode) and _wt_sku (warehouse SKU) for all variations
  const [metaRows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_key, meta_value FROM wp_postmeta
    WHERE post_id IN (${allVarIds.join(',')})
      AND meta_key IN ('_sku', '_wt_sku')
      AND meta_value IS NOT NULL AND meta_value != ''
  `);

  const barcodeById = new Map<number, string>();
  const wtSkuById = new Map<number, string>();
  for (const r of metaRows) {
    if (r.meta_key === '_sku') barcodeById.set(r.post_id, r.meta_value);
    if (r.meta_key === '_wt_sku') wtSkuById.set(r.post_id, r.meta_value);
  }

  let discontinuedCount = 0;

  for (const varId of allVarIds) {
    const warehouseSku = wtSkuById.get(varId) || '';
    const barcode = barcodeById.get(varId) || '';
    if (!warehouseSku) continue;

    const feedProduct = skuLookup.get(warehouseSku);
    if (!feedProduct) continue;

    // Only mark as discontinued if source is williams-inactive AND barcode not in STC
    if (feedProduct.source === 'williams-inactive' && !stcBarcodes.has(barcode)) {
      await db.query(
        `UPDATE wp_posts SET post_status = 'private' WHERE ID = ? AND post_status = 'publish'`,
        [varId]
      );
      discontinuedCount++;

      if (opts.verbose) {
        console.log(`    Discontinued variation ${varId} (SKU: ${warehouseSku}, barcode: ${barcode})`);
      }
    }
  }

  if (discontinuedCount > 0) {
    console.log(`    Marked ${discontinuedCount} variation(s) as discontinued (private)`);
  }

  return discontinuedCount;
}

// ==================== SPLIT EXECUTION ====================

/**
 * Execute an N-way split for one parent product.
 * keepGroup stays on the original parent; each newGroup gets a new parent post.
 */
async function executeSplit(
  db: Connection,
  action: SplitAction,
  opts: ScriptOptions
): Promise<{ success: boolean; newParentIds: number[]; error?: string }> {
  await db.beginTransaction();

  try {
    const { parentId, keepGroup } = action;
    const newParentIds: number[] = [];

    // Load original parent post data
    const [parentRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM wp_posts WHERE ID = ?`, [parentId]
    );
    if (parentRows.length === 0) throw new Error(`Parent post ${parentId} not found`);
    const parent = parentRows[0];

    // Load parent meta once
    const [metaRows] = await db.query<RowDataPacket[]>(
      `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ?`, [parentId]
    );

    // Load taxonomy relationships once
    const [termRels] = await db.query<RowDataPacket[]>(
      `SELECT term_taxonomy_id, term_order FROM wp_term_relationships WHERE object_id = ?`,
      [parentId]
    );

    const SKIP_META_KEYS = new Set([
      '_sku', '_price', '_regular_price', '_sale_price',
      '_default_attributes', '_children',
      '_thumbnail_id', '_product_image_gallery',
    ]);

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Process each new group
    for (const newGroup of action.newGroups) {
      // Create new parent post
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
          now, now,
          parent.post_content_filtered || '',
        ]
      );
      const newParentId = insertResult.insertId;
      newParentIds.push(newParentId);

      // Update GUID
      await db.query(
        `UPDATE wp_posts SET guid = CONCAT('https://wp.maleq.com/?post_type=product&p=', ID) WHERE ID = ?`,
        [newParentId]
      );

      if (opts.verbose) {
        console.log(`    Created new parent ${newParentId} ("${newGroup.newParentTitle}") for ${newGroup.variationIds.length} variations`);
      }

      // Copy parent meta (skip keys we'll set ourselves)
      for (const meta of metaRows) {
        if (SKIP_META_KEYS.has(meta.meta_key)) continue;
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [newParentId, meta.meta_key, meta.meta_value]
        );
      }

      // Set images from this group's variation thumbnails
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
        // Fallback: copy original parent's images
        const origThumb = metaRows.find((m: any) => m.meta_key === '_thumbnail_id');
        const origGallery = metaRows.find((m: any) => m.meta_key === '_product_image_gallery');
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

      // Calculate prices for this group
      const groupPrices = await getVariationPrices(db, newGroup.variationIds);
      const minPrice = groupPrices.length > 0 ? Math.min(...groupPrices) : 0;
      const maxPrice = groupPrices.length > 0 ? Math.max(...groupPrices) : 0;

      const newSku = `SPLIT-${newParentId}`;
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_sku', ?)`,
        [newParentId, newSku]
      );
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_price', ?)`,
        [newParentId, String(minPrice)]
      );

      // Set default attributes from first variation in this group
      const firstVarId = newGroup.variationIds[0];
      const [firstVarAttrs] = await db.query<RowDataPacket[]>(
        `SELECT meta_key, meta_value FROM wp_postmeta
         WHERE post_id = ? AND meta_key LIKE 'attribute_%'`,
        [firstVarId]
      );
      if (firstVarAttrs.length > 0) {
        const defaults: Record<string, string> = {};
        for (const attr of firstVarAttrs) {
          defaults[attr.meta_key.replace('attribute_', '')] = attr.meta_value || '';
        }
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_default_attributes', ?)`,
          [newParentId, serializePhpArray(defaults)]
        );
      }

      // Copy taxonomy relationships
      for (const rel of termRels) {
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
        await db.query(
          `UPDATE wp_posts SET post_parent = ? WHERE ID = ?`,
          [newParentId, varId]
        );
      }

      // Create wp_wc_product_meta_lookup for new parent
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

    // Mark discontinued variations: items only in inactive_products.xml
    // whose barcode is NOT present in the STC feed
    await markDiscontinuedVariations(db, action, opts);

    // Update original parent from remaining (keepGroup) variations
    const keepIds = keepGroup.variationIds;
    if (keepIds.length > 0) {
      const remainPrices = await getVariationPrices(db, keepIds);
      const remainMin = remainPrices.length > 0 ? Math.min(...remainPrices) : 0;
      const remainMax = remainPrices.length > 0 ? Math.max(...remainPrices) : 0;

      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
        [String(remainMin), parentId]
      );

      // Update default attributes
      const firstKeepVarId = keepIds[0];
      const [firstKeepAttrs] = await db.query<RowDataPacket[]>(
        `SELECT meta_key, meta_value FROM wp_postmeta
         WHERE post_id = ? AND meta_key LIKE 'attribute_%'`,
        [firstKeepVarId]
      );
      if (firstKeepAttrs.length > 0) {
        const defaults: Record<string, string> = {};
        for (const attr of firstKeepAttrs) {
          defaults[attr.meta_key.replace('attribute_', '')] = attr.meta_value || '';
        }
        await db.query(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
          [serializePhpArray(defaults), parentId]
        );
      }

      // Update lookup table
      const [origOnsaleRows] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM wp_postmeta
         WHERE post_id IN (${keepIds.join(',')})
           AND meta_key = '_sale_price' AND meta_value != '' AND meta_value != '0'`
      );
      const origOnsale = (origOnsaleRows[0]?.cnt || 0) > 0 ? 1 : 0;

      await db.query(
        `UPDATE wp_wc_product_meta_lookup
         SET min_price = ?, max_price = ?, onsale = ?
         WHERE product_id = ?`,
        [remainMin, remainMax, origOnsale, parentId]
      );
    } else {
      // Original parent left with 0 variations — convert to simple or log warning
      console.log(`    WARNING: Parent ${parentId} left with 0 variations after split`);
    }

    await db.commit();
    return { success: true, newParentIds };

  } catch (err: any) {
    await db.rollback();
    return { success: false, newParentIds: [], error: err.message };
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

// ==================== DUPLICATE ATTRIBUTE DETECTION ====================

async function checkGroupHasDuplicateAttrs(db: Connection, varIds: number[]): Promise<boolean> {
  if (varIds.length < 2) return false;
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, GROUP_CONCAT(CONCAT(meta_key, '=', IFNULL(meta_value,'')) ORDER BY meta_key) as attr_key
    FROM wp_postmeta
    WHERE post_id IN (${varIds.join(',')}) AND meta_key LIKE 'attribute_%'
    GROUP BY post_id
  `);
  const keys = rows.map(r => r.attr_key);
  return new Set(keys).size < keys.length;
}

// ==================== BEFORE/AFTER SNAPSHOT ====================

async function snapshotVariations(db: Connection, varIds: number[], feedNameMap: Map<number, string>): Promise<SnapshotVariation[]> {
  if (varIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT v.ID as id, v.post_status as status,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
      MAX(CASE WHEN pm.meta_key = '_wt_sku' THEN pm.meta_value END) as warehouse_sku,
      MAX(CASE WHEN pm.meta_key = '_price' THEN pm.meta_value END) as price,
      MAX(CASE WHEN pm.meta_key = 'attribute_pa_size' THEN pm.meta_value END) as size_attr
    FROM wp_posts v
    LEFT JOIN wp_postmeta pm ON pm.post_id = v.ID
    WHERE v.ID IN (${varIds.join(',')})
    GROUP BY v.ID
    ORDER BY v.ID
  `);
  return rows.map(r => ({
    id: r.id,
    sku: r.sku || '',
    warehouseSku: r.warehouse_sku || '',
    price: r.price || '',
    sizeAttr: r.size_attr || '',
    feedName: feedNameMap.get(r.id) || '',
    status: r.status || '',
  }));
}

async function snapshotParentSummary(db: Connection, parentId: number): Promise<{
  id: number; title: string; slug: string; variationCount: number; minPrice: string; maxPrice: string;
}> {
  const [pRows] = await db.query<RowDataPacket[]>(
    `SELECT post_title as title, post_name as slug FROM wp_posts WHERE ID = ?`, [parentId]
  );
  const [lookup] = await db.query<RowDataPacket[]>(
    `SELECT min_price, max_price FROM wp_wc_product_meta_lookup WHERE product_id = ?`, [parentId]
  );
  const [varCount] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation'`, [parentId]
  );
  return {
    id: parentId,
    title: pRows[0]?.title || '',
    slug: pRows[0]?.slug || '',
    variationCount: varCount[0]?.cnt || 0,
    minPrice: lookup[0]?.min_price?.toString() || '',
    maxPrice: lookup[0]?.max_price?.toString() || '',
  };
}

// ==================== ANALYSIS ====================

async function analyzeAll(
  db: Connection,
  opts: ScriptOptions
): Promise<SplitReport> {
  console.log('\n--- Step 1: Loading variable products with 3+ variations ---');
  const parents = await loadVariableParents(db, opts);
  console.log(`  Found ${parents.length} variable products with 3+ variations`);

  if (parents.length === 0) return emptyReport();

  const parentIds = parents.map(p => p.id);
  console.log('\n--- Step 2: Loading variations with warehouse SKUs ---');
  const varsByParent = await loadVariationsWithSkus(db, parentIds);

  const totalVars = [...varsByParent.values()].reduce((sum, vs) => sum + vs.length, 0);
  console.log(`  Loaded ${totalVars} variations across ${varsByParent.size} parents`);

  // Count how many have _wt_sku
  let withWtSku = 0;
  for (const vars of varsByParent.values()) {
    for (const v of vars) {
      if (v.warehouseSku) withWtSku++;
    }
  }
  console.log(`  Variations with _wt_sku: ${withWtSku} / ${totalVars}`);

  console.log('\n--- Step 3: Detecting splits ---');

  const report: SplitReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalParentsScanned: parents.length,
      totalSplitCandidates: 0,
      totalVariationsAffected: 0,
      totalNewParentsToCreate: 0,
      totalWithDuplicateAttrs: 0,
      splitsByMethod: {},
    },
    actions: [],
    skipped: [],
  };

  let skuSplitCount = 0;
  let kwSplitCount = 0;

  let priceSplitCount = 0;

  for (const parent of parents) {
    const variations = varsByParent.get(parent.id) || [];
    if (variations.length < 3) continue;

    // Populate feed names early (needed for price refinement title checks and keyword detection)
    await populateFeedNames(variations);

    // === Method 1: SKU prefix grouping (primary) ===
    let skuGroups = groupBySkuPrefix(variations, opts);
    let usedMethod: SplitMethod = 'sku-prefix';

    if (skuGroups && skuGroups.size >= 2) {
      // Refine with price: sub-split mixed-price groups, merge same-price groups
      const refined = refineGroupsByPrice(skuGroups, opts);
      const priceRefined = [...refined.keys()].some(k => k.startsWith('price-'));
      if (priceRefined) usedMethod = 'sku-prefix+price';

      if (refined.size >= 2) {
        const action = await buildSkuSplitAction(db, parent, variations, refined, opts);
        if (action) {
          action.method = usedMethod;
          report.actions.push(action);
          report.summary.totalSplitCandidates++;
          const movedCount = action.newGroups.reduce((s, g) => s + g.variationIds.length, 0);
          report.summary.totalVariationsAffected += movedCount;
          report.summary.totalNewParentsToCreate += action.newGroups.length;
          report.summary.splitsByMethod[usedMethod] = (report.summary.splitsByMethod[usedMethod] || 0) + 1;
          if (action.keepGroupHasDuplicateAttrs || action.newGroups.some(g => g.hasDuplicateAttrs)) {
            report.summary.totalWithDuplicateAttrs++;
          }
          if (priceRefined) priceSplitCount++; else skuSplitCount++;

          if (opts.verbose) {
            console.log(`\n  [${parent.id}] "${parent.title}" (${variations.length} vars) — ${usedMethod} split into ${refined.size} groups`);
            for (const ng of action.newGroups) {
              console.log(`    → "${ng.newParentTitle}" (${ng.variationIds.length} vars, prefix: ${ng.skuPrefix || '?'})`);
            }
            console.log(`    → KEEP "${parent.title}" (${action.keepGroup.variationIds.length} vars)`);
          }
          continue;
        }
      }
    }

    // === Method 2: Price-only grouping (for products without SKU data or where SKU gave 1 group) ===
    const priceGroups = groupByPrice(variations, opts);
    if (priceGroups && priceGroups.size >= 2) {
      const action = await buildSkuSplitAction(db, parent, variations, priceGroups, opts);
      if (action) {
        action.method = 'price';
        report.actions.push(action);
        report.summary.totalSplitCandidates++;
        const movedCount = action.newGroups.reduce((s, g) => s + g.variationIds.length, 0);
        report.summary.totalVariationsAffected += movedCount;
        report.summary.totalNewParentsToCreate += action.newGroups.length;
        report.summary.splitsByMethod['price'] = (report.summary.splitsByMethod['price'] || 0) + 1;
        if (action.keepGroupHasDuplicateAttrs || action.newGroups.some(g => g.hasDuplicateAttrs)) {
          report.summary.totalWithDuplicateAttrs++;
        }
        priceSplitCount++;

        if (opts.verbose) {
          console.log(`\n  [${parent.id}] "${parent.title}" (${variations.length} vars) — price split into ${priceGroups.size} groups`);
        }
        continue;
      }
    }

    // === Method 3: Keyword-based split (fallback) ===
    const kwResult = detectKeywordSplit(parent.title, variations);
    if (kwResult) {
      const action = await buildKeywordSplitAction(db, parent, variations, kwResult, opts);
      if (action) {
        report.actions.push(action);
        report.summary.totalSplitCandidates++;
        report.summary.totalVariationsAffected += kwResult.withIds.length;
        report.summary.totalNewParentsToCreate++;
        report.summary.splitsByMethod['keyword'] = (report.summary.splitsByMethod['keyword'] || 0) + 1;
        if (action.keepGroupHasDuplicateAttrs || action.newGroups.some(g => g.hasDuplicateAttrs)) {
          report.summary.totalWithDuplicateAttrs++;
        }
        kwSplitCount++;

        if (opts.verbose) {
          console.log(`\n  [${parent.id}] "${parent.title}" (${variations.length} vars) — keyword split on "${kwResult.keyword}"`);
          console.log(`    → Move ${kwResult.withIds.length}, Keep ${kwResult.withoutIds.length}`);
        }
        continue;
      }
    }
  }

  console.log(`\n  SKU-prefix splits: ${skuSplitCount}`);
  console.log(`  SKU+price splits: ${priceSplitCount}`);
  console.log(`  Keyword splits:   ${kwSplitCount}`);

  return report;
}

/**
 * Populate feedName on variations from the SKU lookup (lazy).
 */
async function populateFeedNames(variations: VariationData[]): Promise<void> {
  const skuLookup = await getSkuLookup();
  for (const v of variations) {
    if (!v.feedName) {
      // Try warehouse SKU first, then regular SKU
      const feed = (v.warehouseSku && skuLookup.get(v.warehouseSku)) || (v.sku && skuLookup.get(v.sku));
      if (feed) v.feedName = feed.name;
    }
  }
}

async function buildSkuSplitAction(
  db: Connection,
  parent: { id: number; title: string; slug: string },
  variations: VariationData[],
  skuGroups: Map<string, VariationData[]>,
  opts: ScriptOptions
): Promise<SplitAction | null> {
  // Sort groups by size descending — largest stays on original parent
  const sorted = [...skuGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  const [keepPrefix, keepVars] = sorted[0];
  const keepIds = keepVars.map(v => v.id);
  const keepHasDupes = await checkGroupHasDuplicateAttrs(db, keepIds);

  const newGroups: SplitAction['newGroups'] = [];

  for (let i = 1; i < sorted.length; i++) {
    const [rawPrefix, groupVars] = sorted[i];
    const prefix = rawPrefix.replace(/~$/, ''); // Strip re-group marker
    const groupIds = groupVars.map(v => v.id);

    // Derive title for this group
    const title = await deriveGroupTitle(groupVars, prefix, parent.title);
    const hasDupes = await checkGroupHasDuplicateAttrs(db, groupIds);

    newGroups.push({
      label: title,
      variationIds: groupIds,
      skuPrefix: prefix,
      newParentTitle: title,
      newParentSlug: toSlug(title),
      hasDuplicateAttrs: hasDupes,
    });
  }

  if (newGroups.length === 0) return null;

  const cleanKeepPrefix = keepPrefix.replace(/~$/, '');
  return {
    parentId: parent.id,
    parentTitle: parent.title,
    parentSlug: parent.slug,
    method: 'sku-prefix',
    keepGroup: {
      label: parent.title,
      variationIds: keepIds,
      skuPrefix: cleanKeepPrefix,
    },
    newGroups,
    keepGroupHasDuplicateAttrs: keepHasDupes,
  };
}

async function buildKeywordSplitAction(
  db: Connection,
  parent: { id: number; title: string; slug: string },
  variations: VariationData[],
  kwResult: KeywordSplitResult,
  opts: ScriptOptions
): Promise<SplitAction | null> {
  const newTitle = generateKeywordSplitTitle(parent.title, kwResult.label);
  const splitHasDupes = await checkGroupHasDuplicateAttrs(db, kwResult.withIds);
  const keepHasDupes = await checkGroupHasDuplicateAttrs(db, kwResult.withoutIds);

  return {
    parentId: parent.id,
    parentTitle: parent.title,
    parentSlug: parent.slug,
    method: 'keyword',
    keepGroup: {
      label: parent.title,
      variationIds: kwResult.withoutIds,
    },
    newGroups: [{
      label: kwResult.label,
      variationIds: kwResult.withIds,
      newParentTitle: newTitle,
      newParentSlug: toSlug(newTitle),
      hasDuplicateAttrs: splitHasDupes,
    }],
    keepGroupHasDuplicateAttrs: keepHasDupes,
  };
}

function emptyReport(): SplitReport {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalParentsScanned: 0,
      totalSplitCandidates: 0,
      totalVariationsAffected: 0,
      totalNewParentsToCreate: 0,
      totalWithDuplicateAttrs: 0,
      splitsByMethod: {},
    },
    actions: [],
    skipped: [],
  };
}

// ==================== DRY-RUN SQL ====================

function generateDryRunSql(report: SplitReport): string[] {
  const stmts: string[] = [];

  for (const action of report.actions) {
    stmts.push(`-- ================================================================`);
    stmts.push(`-- Split: "${action.parentTitle}" (ID: ${action.parentId})`);
    stmts.push(`-- Method: ${action.method}`);
    stmts.push(`-- Keep group: ${action.keepGroup.variationIds.length} variations (prefix: ${action.keepGroup.skuPrefix || 'n/a'})`);
    stmts.push(`-- New groups: ${action.newGroups.length}`);
    stmts.push(`-- ================================================================`);

    for (const ng of action.newGroups) {
      stmts.push('');
      stmts.push(`-- New product: "${ng.newParentTitle}" (${ng.variationIds.length} variations, prefix: ${ng.skuPrefix || 'n/a'})`);
      stmts.push(`-- 1. Clone parent ${action.parentId} with new title/slug`);
      stmts.push(`INSERT INTO wp_posts (...) SELECT ... FROM wp_posts WHERE ID = ${action.parentId};`);
      stmts.push(`-- SET post_title = '${ng.newParentTitle}', post_name = '${ng.newParentSlug}'`);
      stmts.push(`-- 2. Copy postmeta, taxonomy, set images/prices`);
      stmts.push(`-- 3. Move variations: ${ng.variationIds.join(', ')}`);
      for (const varId of ng.variationIds) {
        stmts.push(`UPDATE wp_posts SET post_parent = NEW_ID WHERE ID = ${varId};`);
      }
      stmts.push(`-- 4. Create wp_wc_product_meta_lookup for NEW_ID`);
    }

    stmts.push('');
    stmts.push(`-- Update original parent pricing from remaining ${action.keepGroup.variationIds.length} variations`);
    stmts.push('');
  }

  return stmts;
}

// ==================== OUTPUT ====================

function printSummary(report: SplitReport) {
  const s = report.summary;
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Variable parents scanned:    ${s.totalParentsScanned}`);
  console.log(`  Split candidates found:      ${s.totalSplitCandidates}`);
  console.log(`  Variations to move:          ${s.totalVariationsAffected}`);
  console.log(`  New parents to create:       ${s.totalNewParentsToCreate}`);

  if (s.totalWithDuplicateAttrs > 0) {
    console.log(`\n  WARNING: ${s.totalWithDuplicateAttrs} product(s) have duplicate variation attributes.`);
    console.log(`  Run fix-duplicate-variations.ts AFTER splitting to fix these.`);
  }

  if (Object.keys(s.splitsByMethod).length > 0) {
    console.log(`\n  Splits by method:`);
    for (const [method, count] of Object.entries(s.splitsByMethod)) {
      console.log(`    ${method}: ${count}`);
    }
  }

  if (report.skipped.length > 0) {
    console.log(`\n  Skipped: ${report.skipped.length} products`);
    for (const skip of report.skipped.slice(0, 10)) {
      console.log(`    [${skip.parentId}] "${skip.parentTitle}" - ${skip.reason}`);
    }
    if (report.skipped.length > 10) {
      console.log(`    ... and ${report.skipped.length - 10} more`);
    }
  }
}

function printSampleActions(report: SplitReport, maxSamples: number = 30) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SPLIT ACTIONS (first ${Math.min(maxSamples, report.actions.length)} of ${report.actions.length})`);
  console.log('='.repeat(70));

  for (let i = 0; i < Math.min(maxSamples, report.actions.length); i++) {
    const action = report.actions[i];
    const totalNew = action.newGroups.reduce((s, g) => s + g.variationIds.length, 0);
    console.log(`\n  [${action.parentId}] "${action.parentTitle}" (${action.method})`);
    console.log(`    Keep: ${action.keepGroup.variationIds.length} vars${action.keepGroup.skuPrefix ? ` (prefix: ${action.keepGroup.skuPrefix})` : ''}`);

    for (const ng of action.newGroups) {
      console.log(`    → "${ng.newParentTitle}" — ${ng.variationIds.length} vars${ng.skuPrefix ? ` (prefix: ${ng.skuPrefix})` : ''}`);
      if (ng.hasDuplicateAttrs) {
        console.log(`      !! WARN: duplicate attribute values`);
      }
    }
    if (action.keepGroupHasDuplicateAttrs) {
      console.log(`    !! WARN: keep group has duplicate attribute values`);
    }
  }
}

function saveReport(report: SplitReport, outputPath: string) {
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

  console.log(`\nSplit Variable Products V2 (SKU-First) - Mode: ${opts.mode.toUpperCase()}`);
  console.log('='.repeat(70));

  const db = await getConnection();

  try {
    const report = await analyzeAll(db, opts);

    if (report.actions.length === 0) {
      console.log('\nNo split candidates found. Nothing to do.');
      return;
    }

    printSummary(report);
    printSampleActions(report);

    const outputPath = opts.output.startsWith('/')
      ? opts.output
      : `${BASE_DIR}/${opts.output}`;
    saveReport(report, outputPath);

    if (opts.mode === 'dry-run') {
      console.log(`\n${'='.repeat(70)}`);
      console.log('DRY RUN - SQL STATEMENTS');
      console.log('='.repeat(70));
      const sql = generateDryRunSql(report);
      for (const stmt of sql) {
        console.log(stmt);
      }
    }

    if (opts.mode === 'apply') {
      console.log(`\n${'='.repeat(70)}`);
      console.log('APPLYING SPLITS');
      console.log('='.repeat(70));

      // Build feed name lookup for snapshots
      const feedNameMap = new Map<number, string>();
      const skuLookup = await getSkuLookup();
      for (const action of report.actions) {
        const allVarIds = [...action.keepGroup.variationIds];
        for (const ng of action.newGroups) {
          allVarIds.push(...ng.variationIds);
        }
        // We need to look up _wt_sku for each variation to get feed names
        if (allVarIds.length > 0) {
          const [metaRows] = await db.query<RowDataPacket[]>(`
            SELECT post_id, meta_key, meta_value FROM wp_postmeta
            WHERE post_id IN (${allVarIds.join(',')})
              AND meta_key IN ('_sku', '_wt_sku')
              AND meta_value IS NOT NULL AND meta_value != ''
          `);
          for (const r of metaRows) {
            const feed = skuLookup.get(r.meta_value);
            if (feed && !feedNameMap.has(r.post_id)) {
              feedNameMap.set(r.post_id, feed.name);
            }
          }
        }
      }

      const splitLog: SplitLog = {
        timestamp: new Date().toISOString(),
        mode: 'apply',
        entries: [],
      };

      let successes = 0;
      let failures = 0;

      for (const action of report.actions) {
        const totalNew = action.newGroups.reduce((s, g) => s + g.variationIds.length, 0);
        process.stdout.write(
          `  Splitting [${action.parentId}] "${action.parentTitle}" (${action.method}, ${action.newGroups.length} new parents)... `
        );

        // Snapshot BEFORE
        const allVarIds = [...action.keepGroup.variationIds];
        for (const ng of action.newGroups) allVarIds.push(...ng.variationIds);
        const beforeVars = await snapshotVariations(db, allVarIds, feedNameMap);

        const entry: SnapshotEntry = {
          parentId: action.parentId,
          parentTitle: action.parentTitle,
          parentSlug: action.parentSlug,
          method: action.method,
          newParents: [],
          originalParentAfter: null,
          before: { variations: beforeVars },
          success: false,
        };

        const result = await executeSplit(db, action, opts);

        if (result.success) {
          console.log(`OK (new IDs: ${result.newParentIds.join(', ')})`);
          successes++;
          entry.success = true;

          // Snapshot AFTER — each new parent
          for (let j = 0; j < action.newGroups.length; j++) {
            const ng = action.newGroups[j];
            const newId = result.newParentIds[j];
            const summary = await snapshotParentSummary(db, newId);
            const movedVars = await snapshotVariations(db, ng.variationIds, feedNameMap);
            entry.newParents.push({
              id: newId,
              title: summary.title,
              slug: summary.slug,
              variationCount: summary.variationCount,
              minPrice: summary.minPrice,
              maxPrice: summary.maxPrice,
              movedVariations: movedVars,
            });
          }

          // Snapshot original parent after
          const origSummary = await snapshotParentSummary(db, action.parentId);
          const remainVars = await snapshotVariations(db, action.keepGroup.variationIds, feedNameMap);
          entry.originalParentAfter = {
            id: action.parentId,
            title: origSummary.title,
            variationCount: origSummary.variationCount,
            minPrice: origSummary.minPrice,
            maxPrice: origSummary.maxPrice,
            remainingVariations: remainVars,
          };
        } else {
          console.log(`FAILED: ${result.error}`);
          failures++;
          entry.error = result.error;
        }

        splitLog.entries.push(entry);
      }

      // Save log
      const logPath = outputPath.replace(/\.json$/, '-log.json');
      writeFileSync(logPath, JSON.stringify(splitLog, null, 2));
      console.log(`\n  Before/after log: ${logPath}`);

      console.log(`\n  Done: ${successes} successful, ${failures} failed`);

      if (report.summary.totalWithDuplicateAttrs > 0) {
        console.log(`\n  REMINDER: ${report.summary.totalWithDuplicateAttrs} product(s) have duplicate attrs.`);
        console.log(`  Run: bun scripts/fix-duplicate-variations.ts --apply --local`);
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
