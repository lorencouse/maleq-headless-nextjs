#!/usr/bin/env bun

/**
 * Split Variable Products with Mixed Product Lines
 *
 * Some variable products have variations representing fundamentally different
 * product lines merged under one parent (e.g., "Gun Oil Lubricant" has both
 * silicone-based and H2O water-based variations). This script splits them by
 * creating new parent products and reassigning variations.
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

import { createReadStream, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
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
  sku: string;
  feedName: string; // from feed lookup
}

interface SplitSignalResult {
  keyword: string;
  label: string;         // Human-readable label for the new product
  withIds: number[];     // Variation IDs that match the keyword
  withoutIds: number[];  // Variation IDs that don't match
  ratio: number;         // Closeness to 50/50 (0 = perfect split, 1 = all on one side)
}

interface SplitCandidate {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  totalVariations: number;
  primarySplit: SplitSignalResult;
  alternativeSplits: SplitSignalResult[];
  variations: VariationData[];
}

interface SplitAction {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  keyword: string;
  newParentTitle: string;
  newParentSlug: string;
  splitGroupIds: number[];     // Variations moving to new parent
  remainingGroupIds: number[]; // Variations staying with original
  splitGroupSkus: string[];
  remainingGroupSkus: string[];
  splitGroupHasDuplicateAttrs: boolean;    // Warning: split group has duplicate attribute values
  remainingGroupHasDuplicateAttrs: boolean; // Warning: remaining group has duplicate attribute values
}

interface SplitReport {
  timestamp: string;
  summary: {
    totalParentsScanned: number;
    totalSplitCandidates: number;
    totalVariationsAffected: number;
    totalNewParentsToCreate: number;
    totalWithDuplicateAttrs: number;
    splitsByKeyword: Record<string, number>;
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
  price: string;
  sizeAttr: string;
  feedName: string;
  status: string;
}

interface SnapshotEntry {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  newParentId?: number;
  newParentTitle: string;
  newParentSlug: string;
  keyword: string;
  before: {
    variations: SnapshotVariation[];
  };
  after?: {
    originalParent: { id: number; title: string; variationCount: number; minPrice: string; maxPrice: string };
    newParent: { id: number; title: string; variationCount: number; minPrice: string; maxPrice: string };
    movedVariations: SnapshotVariation[];
    remainingVariations: SnapshotVariation[];
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
Split Variable Products with Mixed Product Lines
=================================================
Finds variable products where variations represent different product lines
(e.g., silicone vs water-based lubricant) and splits them into separate
parent products, each with their own variations.

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

// ==================== FEED PARSING ====================
// Reused from fix-duplicate-variations.ts

const BASE_DIR = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless';

const WILLIAMS_XML_FILES = [
  `${BASE_DIR}/data/product-feeds/products-filtered.xml`,
  `${BASE_DIR}/data/product-feeds/inactive_products.xml`,
];

const STC_CSV_FILE = `${BASE_DIR}/data/product-feeds/stc-product-feed.csv`;

async function parseWilliamsXml(filePath: string, skuMap: Map<string, FeedProduct>): Promise<number> {
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
        currentProduct = { source: 'williams' };
        buffer = line + '\n';
      }

      if (inProduct && line.includes('</product>')) {
        const block = buffer;
        const sku = extractXmlField(block, 'sku');
        if (sku) {
          currentProduct.sku = sku;
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

async function parseStcCsv(filePath: string, skuMap: Map<string, FeedProduct>): Promise<number> {
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
    });

    parser.on('end', () => resolve(count));
    parser.on('error', reject);
  });
}

async function buildSkuLookup(): Promise<Map<string, FeedProduct>> {
  console.log('\n--- Step 1: Building SKU lookup from product feeds ---');
  const skuMap = new Map<string, FeedProduct>();

  for (const xmlFile of WILLIAMS_XML_FILES) {
    const count = await parseWilliamsXml(xmlFile, skuMap);
    console.log(`    -> Added ${count.toLocaleString()} products`);
  }

  const stcCount = await parseStcCsv(STC_CSV_FILE, skuMap);
  console.log(`    -> Added ${stcCount.toLocaleString()} STC products`);

  console.log(`  Total SKU lookup entries: ${skuMap.size.toLocaleString()}`);
  return skuMap;
}

// ==================== PHP SERIALIZATION ====================

interface ProductAttribute {
  name: string;
  value: string;
  position: number;
  is_visible: number;
  is_variation: number;
  is_taxonomy: number;
}

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
        // double/float
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

// ==================== SPLIT SIGNALS ====================
// Reused from scan-split-candidates.ts

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

// Trailing product nouns - label is inserted before these in the title
const PRODUCT_NOUNS = /\b(lubricant|lube|dildo|dong|vibrator|plug|vibe|massager|ring|sleeve|stroker|pump|cock|penis|strap-on|harness|stimulator|wand|bullet|egg|beads|probe|kit|set|cream|gel|oil|spray|wash|cleanser|enhancer)\b/i;

// ==================== TITLE GENERATION ====================

/**
 * Generate a new product title by inserting a label before the trailing product noun.
 * "Gun Oil Lubricant" + "H2O" -> "Gun Oil H2O Lubricant"
 * "King Cock Cock" + "Vibrating" -> "King Cock Vibrating Cock"
 */
function generateSplitTitle(parentTitle: string, label: string): string {
  // Check if the label is already in the title
  if (new RegExp(`\\b${escapeRegex(label)}\\b`, 'i').test(parentTitle)) {
    return parentTitle;
  }

  // Find the last product noun in the title
  const words = parentTitle.split(/\s+/);
  let insertIndex = words.length; // default: append at end

  for (let i = words.length - 1; i >= 0; i--) {
    if (PRODUCT_NOUNS.test(words[i].replace(/[^a-zA-Z-]/g, ''))) {
      insertIndex = i;
      break;
    }
  }

  // If we'd insert at position 0, just append instead
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
  console.log('\n--- Step 2: Loading variable products with 3+ variations ---');

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
  console.log(`  Found ${rows.length} variable products with 3+ variations`);
  return rows as any[];
}

async function loadVariationsForParents(
  db: Connection,
  parentIds: number[],
  skuMap: Map<string, FeedProduct>
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

  // Get SKUs
  const varIds = varRows.map(v => v.id);
  if (varIds.length === 0) return new Map();

  const [skuRows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_value as sku
    FROM wp_postmeta
    WHERE post_id IN (${varIds.join(',')}) AND meta_key = '_sku' AND meta_value != ''
  `);
  const skuById = new Map<number, string>();
  for (const r of skuRows) skuById.set(r.post_id, r.sku);

  const result = new Map<number, VariationData[]>();
  for (const v of varRows) {
    const sku = skuById.get(v.id) || '';
    const feedProduct = sku ? skuMap.get(sku) : undefined;

    const varData: VariationData = {
      id: v.id,
      parentId: v.parentId,
      title: v.title,
      slug: v.slug,
      excerpt: v.excerpt || '',
      status: v.status,
      sku,
      feedName: feedProduct?.name || '',
    };

    if (!result.has(v.parentId)) result.set(v.parentId, []);
    result.get(v.parentId)!.push(varData);
  }

  return result;
}

// ==================== SPLIT DETECTION ====================

function detectSplits(
  parentTitle: string,
  variations: VariationData[],
  opts: ScriptOptions
): SplitSignalResult[] {
  const results: SplitSignalResult[] = [];

  for (const [keyword, { patterns, label }] of Object.entries(SPLIT_SIGNALS)) {
    // Skip if keyword is in parent title (means ALL variations are that type)
    const inParentTitle = patterns.some(pat => pat.test(parentTitle));
    if (inParentTitle) {
      if (opts.verbose) {
        console.log(`    [${keyword}] skipped - in parent title`);
      }
      continue;
    }

    const withIds: number[] = [];
    const withoutIds: number[] = [];

    for (const v of variations) {
      // Check feed name first, fallback to title + excerpt
      const searchText = v.feedName || `${v.title} ${v.excerpt}`;
      if (patterns.some(pat => pat.test(searchText))) {
        withIds.push(v.id);
      } else {
        withoutIds.push(v.id);
      }
    }

    // True split: keyword in 2+ variations AND absent from 2+ others
    if (withIds.length >= 2 && withoutIds.length >= 2) {
      const total = variations.length;
      const ratio = Math.abs(withIds.length - withoutIds.length) / total;
      results.push({ keyword, label, withIds, withoutIds, ratio });
    }
  }

  // Sort by ratio (closest to 50/50 first)
  results.sort((a, b) => a.ratio - b.ratio);
  return results;
}

function pickPrimarySplit(
  splits: SplitSignalResult[],
  variations: VariationData[],
  opts: ScriptOptions
): { primary: SplitSignalResult; alternatives: SplitSignalResult[] } | null {
  if (splits.length === 0) return null;

  // Filter: each group must have 2+ variations
  const valid = splits.filter(s => s.withIds.length >= 2 && s.withoutIds.length >= 2);
  if (valid.length === 0) return null;

  const primary = valid[0]; // best ratio (already sorted)
  const alternatives = valid.slice(1);

  return { primary, alternatives };
}

// ==================== SPLIT EXECUTION ====================

async function executeSplit(
  db: Connection,
  action: SplitAction,
  opts: ScriptOptions
): Promise<{ success: boolean; newParentId?: number; error?: string }> {
  await db.beginTransaction();

  try {
    const { parentId, newParentTitle, newParentSlug, splitGroupIds, remainingGroupIds } = action;

    // Step 1: Load original parent post data
    const [parentRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM wp_posts WHERE ID = ?`, [parentId]
    );
    if (parentRows.length === 0) throw new Error(`Parent post ${parentId} not found`);
    const parent = parentRows[0];

    // Step 2: Generate unique slug
    const baseSlug = toSlug(newParentTitle);
    const finalSlug = await ensureUniqueSlug(db, baseSlug, parentId);

    // Step 3: Create new parent post (clone of original with new title/slug)
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
        parent.post_content, newParentTitle,
        parent.post_excerpt, parent.post_status, parent.comment_status,
        parent.ping_status, parent.post_password,
        finalSlug, parent.to_ping || '', parent.pinged || '',
        now, now,
        parent.post_content_filtered || '',
      ]
    );
    const newParentId = insertResult.insertId;

    // Update GUID
    await db.query(
      `UPDATE wp_posts SET guid = CONCAT('https://wp.maleq.com/?post_type=product&p=', ID) WHERE ID = ?`,
      [newParentId]
    );

    if (opts.verbose) {
      console.log(`    Created new parent post ID: ${newParentId} ("${newParentTitle}")`);
    }

    // Step 4: Copy parent meta (except fields we'll set from variation data)
    const SKIP_META_KEYS = new Set([
      '_sku', '_price', '_regular_price', '_sale_price',
      '_default_attributes', '_children',
      '_thumbnail_id', '_product_image_gallery',
    ]);

    const [metaRows] = await db.query<RowDataPacket[]>(
      `SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ?`, [parentId]
    );

    for (const meta of metaRows) {
      if (SKIP_META_KEYS.has(meta.meta_key)) continue;
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [newParentId, meta.meta_key, meta.meta_value]
      );
    }

    // Step 4b: Set images from split group's variation thumbnails
    const [varThumbRows] = await db.query<RowDataPacket[]>(
      `SELECT post_id, meta_value FROM wp_postmeta
       WHERE post_id IN (${splitGroupIds.join(',')}) AND meta_key = '_thumbnail_id'
         AND meta_value IS NOT NULL AND meta_value != '' AND meta_value != '0'
       ORDER BY post_id`
    );
    const varThumbs = varThumbRows.map(r => r.meta_value).filter(Boolean);
    if (varThumbs.length > 0) {
      // First variation's thumbnail becomes the parent thumbnail
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
        [newParentId, varThumbs[0]]
      );
      // Remaining unique thumbnails become the gallery
      const uniqueThumbs = [...new Set(varThumbs)];
      if (uniqueThumbs.length > 1) {
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
          [newParentId, uniqueThumbs.slice(1).join(',')]
        );
      }
    } else {
      // Fallback: copy original parent's images if no variation thumbnails
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

    // Step 5: Calculate prices for split group
    const splitPrices = await getVariationPrices(db, splitGroupIds);
    const splitMinPrice = splitPrices.length > 0 ? Math.min(...splitPrices) : 0;
    const splitMaxPrice = splitPrices.length > 0 ? Math.max(...splitPrices) : 0;

    // Generate SKU for new parent
    const newSku = `SPLIT-${newParentId}`;
    await db.query(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_sku', ?)`,
      [newParentId, newSku]
    );
    await db.query(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_price', ?)`,
      [newParentId, String(splitMinPrice)]
    );

    // Set _default_attributes from existing parent (both parents keep same attribute structure)
    const [defaultAttrRows] = await db.query<RowDataPacket[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_default_attributes'`,
      [parentId]
    );
    if (defaultAttrRows.length > 0 && defaultAttrRows[0].meta_value) {
      // Recalculate default attributes based on first variation in split group
      const firstVarId = splitGroupIds[0];
      const [firstVarAttrs] = await db.query<RowDataPacket[]>(
        `SELECT meta_key, meta_value FROM wp_postmeta
         WHERE post_id = ? AND meta_key LIKE 'attribute_%'`,
        [firstVarId]
      );
      if (firstVarAttrs.length > 0) {
        const defaults: Record<string, string> = {};
        for (const attr of firstVarAttrs) {
          const taxName = attr.meta_key.replace('attribute_', '');
          defaults[taxName] = attr.meta_value || '';
        }
        const serialized = serializePhpArray(defaults);
        await db.query(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_default_attributes', ?)`,
          [newParentId, serialized]
        );
      }
    }

    // Step 6: Copy taxonomy relationships (categories, brands, tags, product_type, visibility)
    const [termRels] = await db.query<RowDataPacket[]>(
      `SELECT term_taxonomy_id, term_order FROM wp_term_relationships WHERE object_id = ?`,
      [parentId]
    );
    for (const rel of termRels) {
      await db.query(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, ?)`,
        [newParentId, rel.term_taxonomy_id, rel.term_order]
      );
      // Update taxonomy count
      await db.query(
        `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
        [rel.term_taxonomy_id]
      );
    }

    // Step 7: Move variations to new parent
    for (const varId of splitGroupIds) {
      await db.query(
        `UPDATE wp_posts SET post_parent = ? WHERE ID = ?`,
        [newParentId, varId]
      );
    }

    if (opts.verbose) {
      console.log(`    Moved ${splitGroupIds.length} variations to new parent ${newParentId}`);
    }

    // Step 8: Update original parent pricing from remaining variations
    const remainingPrices = await getVariationPrices(db, remainingGroupIds);
    const remainMinPrice = remainingPrices.length > 0 ? Math.min(...remainingPrices) : 0;
    const remainMaxPrice = remainingPrices.length > 0 ? Math.max(...remainingPrices) : 0;

    await db.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
      [String(remainMinPrice), parentId]
    );

    // Update original parent's default_attributes based on first remaining variation
    if (remainingGroupIds.length > 0) {
      const firstRemainVarId = remainingGroupIds[0];
      const [firstRemainAttrs] = await db.query<RowDataPacket[]>(
        `SELECT meta_key, meta_value FROM wp_postmeta
         WHERE post_id = ? AND meta_key LIKE 'attribute_%'`,
        [firstRemainVarId]
      );
      if (firstRemainAttrs.length > 0) {
        const defaults: Record<string, string> = {};
        for (const attr of firstRemainAttrs) {
          const taxName = attr.meta_key.replace('attribute_', '');
          defaults[taxName] = attr.meta_value || '';
        }
        const serialized = serializePhpArray(defaults);
        await db.query(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_default_attributes'`,
          [serialized, parentId]
        );
      }
    }

    // Step 9: Create wp_wc_product_meta_lookup row for new parent
    // Get onsale status from split variations
    const [onsaleRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM wp_postmeta
       WHERE post_id IN (${splitGroupIds.join(',')})
         AND meta_key = '_sale_price' AND meta_value != '' AND meta_value != '0'`
    );
    const onsale = (onsaleRows[0]?.cnt || 0) > 0 ? 1 : 0;

    await db.query(
      `INSERT INTO wp_wc_product_meta_lookup (
        product_id, sku, \`virtual\`, downloadable, min_price, max_price,
        onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales, tax_status, tax_class
      ) VALUES (?, ?, 0, 0, ?, ?, ?, 0, 'instock', 0, 0, 0, 'taxable', '')`,
      [newParentId, newSku, splitMinPrice, splitMaxPrice, onsale]
    );

    // Update original parent's lookup table
    const [origOnsaleRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM wp_postmeta
       WHERE post_id IN (${remainingGroupIds.join(',')})
         AND meta_key = '_sale_price' AND meta_value != '' AND meta_value != '0'`
    );
    const origOnsale = (origOnsaleRows[0]?.cnt || 0) > 0 ? 1 : 0;

    await db.query(
      `UPDATE wp_wc_product_meta_lookup
       SET min_price = ?, max_price = ?, onsale = ?
       WHERE product_id = ?`,
      [remainMinPrice, remainMaxPrice, origOnsale, parentId]
    );

    await db.commit();
    return { success: true, newParentId };

  } catch (err: any) {
    await db.rollback();
    return { success: false, error: err.message };
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
    price: r.price || '',
    sizeAttr: r.size_attr || '',
    feedName: feedNameMap.get(r.id) || '',
    status: r.status || '',
  }));
}

async function snapshotParentSummary(db: Connection, parentId: number): Promise<{
  id: number; title: string; variationCount: number; minPrice: string; maxPrice: string;
}> {
  const [pRows] = await db.query<RowDataPacket[]>(
    `SELECT post_title as title FROM wp_posts WHERE ID = ?`, [parentId]
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
    variationCount: varCount[0]?.cnt || 0,
    minPrice: lookup[0]?.min_price?.toString() || '',
    maxPrice: lookup[0]?.max_price?.toString() || '',
  };
}

// ==================== ANALYSIS & REPORTING ====================

async function analyzeAll(
  db: Connection,
  skuMap: Map<string, FeedProduct>,
  opts: ScriptOptions
): Promise<SplitReport> {
  const parents = await loadVariableParents(db, opts);

  if (parents.length === 0) {
    return emptyReport();
  }

  const parentIds = parents.map(p => p.id);
  console.log(`\n--- Step 3: Loading variations and detecting splits ---`);
  const varsByParent = await loadVariationsForParents(db, parentIds, skuMap);

  const report: SplitReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalParentsScanned: parents.length,
      totalSplitCandidates: 0,
      totalVariationsAffected: 0,
      totalNewParentsToCreate: 0,
      totalWithDuplicateAttrs: 0,
      splitsByKeyword: {},
    },
    actions: [],
    skipped: [],
  };

  for (const parent of parents) {
    const variations = varsByParent.get(parent.id) || [];
    if (variations.length < 3) continue;

    const splits = detectSplits(parent.title, variations, opts);

    if (splits.length === 0) continue;

    const picked = pickPrimarySplit(splits, variations, opts);
    if (!picked) continue;

    const { primary, alternatives } = picked;

    // Validate: lone variations (1 in a group) get absorbed into the other group
    let splitGroupIds = primary.withIds;
    let remainingGroupIds = primary.withoutIds;

    // If split group has only 1 member, try alternatives
    if (splitGroupIds.length < 2) {
      report.skipped.push({
        parentId: parent.id,
        parentTitle: parent.title,
        reason: `Split group for "${primary.keyword}" has only ${splitGroupIds.length} variation(s)`,
      });
      continue;
    }
    if (remainingGroupIds.length < 2) {
      report.skipped.push({
        parentId: parent.id,
        parentTitle: parent.title,
        reason: `Remaining group after "${primary.keyword}" split has only ${remainingGroupIds.length} variation(s)`,
      });
      continue;
    }

    // Build the action
    const newTitle = generateSplitTitle(parent.title, primary.label);
    const newSlug = toSlug(newTitle);

    const varMap = new Map<number, VariationData>();
    for (const v of variations) varMap.set(v.id, v);

    // Check for duplicate attributes in each group
    const splitHasDupes = await checkGroupHasDuplicateAttrs(db, splitGroupIds);
    const remainHasDupes = await checkGroupHasDuplicateAttrs(db, remainingGroupIds);

    const action: SplitAction = {
      parentId: parent.id,
      parentTitle: parent.title,
      parentSlug: parent.slug,
      keyword: primary.keyword,
      newParentTitle: newTitle,
      newParentSlug: newSlug,
      splitGroupIds,
      remainingGroupIds,
      splitGroupSkus: splitGroupIds.map(id => varMap.get(id)?.sku || ''),
      remainingGroupSkus: remainingGroupIds.map(id => varMap.get(id)?.sku || ''),
      splitGroupHasDuplicateAttrs: splitHasDupes,
      remainingGroupHasDuplicateAttrs: remainHasDupes,
    };

    report.actions.push(action);
    report.summary.totalSplitCandidates++;
    report.summary.totalVariationsAffected += splitGroupIds.length;
    report.summary.totalNewParentsToCreate++;
    if (splitHasDupes || remainHasDupes) {
      report.summary.totalWithDuplicateAttrs++;
    }
    report.summary.splitsByKeyword[primary.keyword] =
      (report.summary.splitsByKeyword[primary.keyword] || 0) + 1;

    if (opts.verbose) {
      console.log(`\n  [${parent.id}] "${parent.title}" (${variations.length} vars)`);
      console.log(`    Split on "${primary.keyword}": ${splitGroupIds.length} move / ${remainingGroupIds.length} stay`);
      console.log(`    New title: "${newTitle}"`);
      if (alternatives.length > 0) {
        console.log(`    Alternatives: ${alternatives.map(a => `${a.keyword}(${a.withIds.length}/${a.withoutIds.length})`).join(', ')}`);
      }
    }
  }

  return report;
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
      splitsByKeyword: {},
    },
    actions: [],
    skipped: [],
  };
}

// ==================== SQL GENERATION (dry-run) ====================

function generateDryRunSql(report: SplitReport): string[] {
  const stmts: string[] = [];

  for (const action of report.actions) {
    stmts.push(`-- ================================================================`);
    stmts.push(`-- Split: "${action.parentTitle}" (ID: ${action.parentId})`);
    stmts.push(`-- Keyword: ${action.keyword}`);
    stmts.push(`-- New product: "${action.newParentTitle}" (slug: ${action.newParentSlug})`);
    stmts.push(`-- Moving ${action.splitGroupIds.length} variations, keeping ${action.remainingGroupIds.length}`);
    stmts.push(`-- ================================================================`);
    stmts.push('');

    stmts.push(`-- 1. Create new parent post (clone of ${action.parentId})`);
    stmts.push(`INSERT INTO wp_posts (...) SELECT ... FROM wp_posts WHERE ID = ${action.parentId};`);
    stmts.push(`-- SET post_title = '${action.newParentTitle}', post_name = '${action.newParentSlug}'`);
    stmts.push('');

    stmts.push(`-- 2. Copy postmeta from parent ${action.parentId} to NEW_ID`);
    stmts.push(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) SELECT NEW_ID, meta_key, meta_value FROM wp_postmeta WHERE post_id = ${action.parentId};`);
    stmts.push('');

    stmts.push(`-- 3. Copy taxonomy relationships`);
    stmts.push(`INSERT IGNORE INTO wp_term_relationships SELECT NEW_ID, term_taxonomy_id, term_order FROM wp_term_relationships WHERE object_id = ${action.parentId};`);
    stmts.push('');

    stmts.push(`-- 4. Move variations to new parent`);
    for (const varId of action.splitGroupIds) {
      stmts.push(`UPDATE wp_posts SET post_parent = NEW_ID WHERE ID = ${varId};`);
    }
    stmts.push('');

    stmts.push(`-- 5. Update prices for both parents`);
    stmts.push(`-- (calculated at runtime from variation prices)`);
    stmts.push('');

    stmts.push(`-- 6. Create wp_wc_product_meta_lookup for NEW_ID`);
    stmts.push(`INSERT INTO wp_wc_product_meta_lookup (...) VALUES (NEW_ID, ...);`);
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

  if (Object.keys(s.splitsByKeyword).length > 0) {
    console.log(`\n  Splits by keyword:`);
    const sorted = Object.entries(s.splitsByKeyword).sort((a, b) => b[1] - a[1]);
    for (const [kw, count] of sorted) {
      console.log(`    ${kw}: ${count}`);
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

function printSampleActions(report: SplitReport, maxSamples: number = 20) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SPLIT ACTIONS (first ${Math.min(maxSamples, report.actions.length)})`);
  console.log('='.repeat(70));

  for (let i = 0; i < Math.min(maxSamples, report.actions.length); i++) {
    const action = report.actions[i];
    console.log(`\n  [${action.parentId}] "${action.parentTitle}"`);
    console.log(`    Keyword: ${action.keyword}`);
    console.log(`    New product: "${action.newParentTitle}"`);
    console.log(`    Moving: ${action.splitGroupIds.length} variations (${action.splitGroupSkus.filter(Boolean).join(', ') || 'no SKUs'})`);
    console.log(`    Keeping: ${action.remainingGroupIds.length} variations (${action.remainingGroupSkus.filter(Boolean).join(', ') || 'no SKUs'})`);
    if (action.splitGroupHasDuplicateAttrs) {
      console.log(`    !! WARN: Split group has duplicate attribute values - needs fix-duplicate-variations`);
    }
    if (action.remainingGroupHasDuplicateAttrs) {
      console.log(`    !! WARN: Remaining group has duplicate attribute values - needs fix-duplicate-variations`);
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

  console.log(`\nSplit Variable Products - Mode: ${opts.mode.toUpperCase()}`);
  console.log('='.repeat(70));

  // Step 1: Build SKU lookup from feeds
  const skuMap = await buildSkuLookup();

  // Step 2-3: Connect and analyze
  const db = await getConnection();

  try {
    const report = await analyzeAll(db, skuMap, opts);

    if (report.actions.length === 0) {
      console.log('\nNo split candidates found. Nothing to do.');
      return;
    }

    // Print summary and samples
    printSummary(report);
    printSampleActions(report);

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
      for (const action of report.actions) {
        const allIds = [...action.splitGroupIds, ...action.remainingGroupIds];
        const allSkus = [...action.splitGroupSkus, ...action.remainingGroupSkus];
        for (let i = 0; i < allIds.length; i++) {
          const sku = allSkus[i];
          if (sku) {
            const feed = skuMap.get(sku);
            if (feed) feedNameMap.set(allIds[i], feed.name);
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
        process.stdout.write(
          `  Splitting [${action.parentId}] "${action.parentTitle}" on "${action.keyword}"... `
        );

        // Snapshot BEFORE
        const allVarIds = [...action.splitGroupIds, ...action.remainingGroupIds];
        const beforeVars = await snapshotVariations(db, allVarIds, feedNameMap);

        const entry: SnapshotEntry = {
          parentId: action.parentId,
          parentTitle: action.parentTitle,
          parentSlug: action.parentSlug,
          newParentTitle: action.newParentTitle,
          newParentSlug: action.newParentSlug,
          keyword: action.keyword,
          before: { variations: beforeVars },
          success: false,
        };

        const result = await executeSplit(db, action, opts);

        if (result.success) {
          console.log(`OK (new parent: ${result.newParentId})`);
          successes++;
          entry.success = true;
          entry.newParentId = result.newParentId;

          // Snapshot AFTER
          const movedVars = await snapshotVariations(db, action.splitGroupIds, feedNameMap);
          const remainingVars = await snapshotVariations(db, action.remainingGroupIds, feedNameMap);
          const origSummary = await snapshotParentSummary(db, action.parentId);
          const newSummary = await snapshotParentSummary(db, result.newParentId!);

          entry.after = {
            originalParent: origSummary,
            newParent: newSummary,
            movedVariations: movedVars,
            remainingVariations: remainingVars,
          };
        } else {
          console.log(`FAILED: ${result.error}`);
          failures++;
          entry.error = result.error;
        }

        splitLog.entries.push(entry);
      }

      // Save the before/after log
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
