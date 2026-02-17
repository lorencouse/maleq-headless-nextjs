/**
 * Product Data Merger
 *
 * Merges 3 data sources into unified product records:
 *   1. WordPress database (source of truth for taxonomies, IDs, images)
 *   2. XML feeds (active + inactive from Williams Trading / MUFFS)
 *   3. STC CSV feed
 *
 * Merge priority per field: DB taxonomies > XML active > XML inactive > STC
 */

import type { Connection } from 'mysql2/promise';
import { existsSync } from 'fs';
import { join } from 'path';
import { XMLParser, type XMLProduct } from '../../lib/import/xml-parser';
import { STCCSVParser, type STCProduct } from '../../lib/import/stc-csv-parser';
import { getConnection } from './db';
import { decode } from 'html-entities';

// ─── Types ───

export interface MergedProduct {
  postId: number;
  postType: 'product' | 'product_variation';
  parentId: number | null;
  sku: string;
  barcode: string;
  title: string;
  existingDescription: string;
  existingExcerpt: string;

  // Merged descriptive data (best available from all sources)
  mergedDescription: string;
  mergedFeatures: string[];
  mergedSpecifications: Record<string, string>;

  // Taxonomies (from DB)
  brand: string;
  categories: string[];
  material: string;

  // Images (resolved URLs from DB)
  thumbnailUrl: string;
  galleryImageUrls: string[];

  // Feed data sources that matched
  dataSources: string[];

  // Variation info
  variationCount: number;
}

interface DbProduct {
  ID: number;
  post_type: string;
  post_parent: number;
  post_title: string;
  post_name: string;
  post_content: string;
  post_excerpt: string;
}

interface DbMeta {
  post_id: number;
  sku: string | null;
  barcode: string | null;
  thumbnail_id: string | null;
  gallery_ids: string | null;
  product_source: string | null;
}

interface DbTaxRow {
  post_id: number;
  taxonomy: string;
  name: string;
}

interface DbAttachment {
  ID: number;
  guid: string;
}

// ─── Data loading ───

const DATA_DIR = join(process.cwd(), 'data');

async function loadXmlFeed(filename: string): Promise<Map<string, XMLProduct>> {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) {
    console.log(`  ℹ XML feed not found: ${filename}, skipping`);
    return new Map();
  }
  const parser = new XMLParser(path);
  const products = await parser.parseProducts();
  const map = new Map<string, XMLProduct>();
  for (const p of products) {
    if (p.barcode) map.set(p.barcode, p);
  }
  console.log(`  ✓ Loaded ${products.length} products from ${filename} (${map.size} with barcodes)`);
  return map;
}

async function loadStcFeed(): Promise<Map<string, STCProduct>> {
  const path = join(DATA_DIR, 'stc-product-feed.csv');
  if (!existsSync(path)) {
    console.log('  ℹ STC feed not found, skipping');
    return new Map();
  }
  const parser = new STCCSVParser(path);
  const products = await parser.parseProducts();
  const map = new Map<string, STCProduct>();
  for (const p of products) {
    if (p.upc) map.set(p.upc, p);
  }
  console.log(`  ✓ Loaded ${products.length} products from STC CSV (${map.size} with UPCs)`);
  return map;
}

// ─── DB queries (parallel, following export-products.ts pattern) ───

async function fetchProducts(db: Connection): Promise<DbProduct[]> {
  const [rows] = await db.query(
    `SELECT ID, post_type, post_parent, post_title, post_name, post_content, post_excerpt
     FROM wp_posts
     WHERE post_type IN ('product', 'product_variation') AND post_status = 'publish'`
  );
  return rows as DbProduct[];
}

async function fetchProductMeta(db: Connection): Promise<Map<number, DbMeta>> {
  const [rows] = await db.query(
    `SELECT pm.post_id,
       MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku,
       MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) AS barcode,
       MAX(CASE WHEN pm.meta_key = '_thumbnail_id' THEN pm.meta_value END) AS thumbnail_id,
       MAX(CASE WHEN pm.meta_key = '_product_image_gallery' THEN pm.meta_value END) AS gallery_ids,
       MAX(CASE WHEN pm.meta_key = '_product_source' THEN pm.meta_value END) AS product_source
     FROM wp_postmeta pm
     INNER JOIN wp_posts p ON pm.post_id = p.ID
     WHERE p.post_type IN ('product', 'product_variation') AND p.post_status = 'publish'
       AND pm.meta_key IN ('_sku', '_wt_barcode', '_thumbnail_id', '_product_image_gallery', '_product_source')
     GROUP BY pm.post_id`
  );
  const map = new Map<number, DbMeta>();
  for (const row of rows as DbMeta[]) {
    map.set(row.post_id, row);
  }
  return map;
}

async function fetchTaxonomies(db: Connection): Promise<Map<number, DbTaxRow[]>> {
  const [rows] = await db.query(
    `SELECT tr.object_id AS post_id, tt.taxonomy, t.name
     FROM wp_term_relationships tr
     JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
     JOIN wp_terms t ON tt.term_id = t.term_id
     INNER JOIN wp_posts p ON tr.object_id = p.ID
     WHERE p.post_type = 'product' AND p.post_status = 'publish'
       AND tt.taxonomy IN ('product_cat', 'product_brand', 'product_material')`
  );
  const map = new Map<number, DbTaxRow[]>();
  for (const row of rows as DbTaxRow[]) {
    const list = map.get(row.post_id) || [];
    list.push(row);
    map.set(row.post_id, list);
  }
  return map;
}

async function fetchAttachments(db: Connection): Promise<Map<number, string>> {
  const [rows] = await db.query(
    `SELECT ID, guid FROM wp_posts WHERE post_type = 'attachment' AND post_mime_type LIKE 'image/%'`
  );
  const map = new Map<number, string>();
  for (const row of rows as DbAttachment[]) {
    map.set(row.ID, row.guid);
  }
  return map;
}

async function fetchVariationCounts(db: Connection): Promise<Map<number, number>> {
  const [rows] = await db.query(
    `SELECT post_parent, COUNT(*) AS cnt
     FROM wp_posts
     WHERE post_type = 'product_variation' AND post_status = 'publish'
     GROUP BY post_parent`
  );
  const map = new Map<number, number>();
  for (const row of rows as Array<{ post_parent: number; cnt: number }>) {
    map.set(row.post_parent, row.cnt);
  }
  return map;
}

// ─── Image URL resolution ───

function resolveImageUrls(
  ids: string | null,
  attachments: Map<number, string>
): string[] {
  if (!ids) return [];
  return ids
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id))
    .map((id) => attachments.get(id))
    .filter((url): url is string => !!url);
}

// ─── Merge logic ───

function decodeEntities(text: string): string {
  if (!text) return '';
  return decode(text);
}

function mergeDescription(
  dbDesc: string,
  xmlProduct: XMLProduct | undefined,
  stcProduct: STCProduct | undefined
): string {
  // Return the longest/best description available
  const candidates: string[] = [];
  if (dbDesc) candidates.push(decodeEntities(dbDesc));
  if (xmlProduct?.description) candidates.push(decodeEntities(xmlProduct.description));
  if (stcProduct?.description) candidates.push(decodeEntities(stcProduct.description));
  // Return longest non-empty description
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function mergeFeatures(
  xmlProduct: XMLProduct | undefined,
  stcProduct: STCProduct | undefined
): string[] {
  const features: string[] = [];
  if (stcProduct?.features) {
    features.push(...STCCSVParser.parseFeatures(stcProduct.features));
  }
  if (stcProduct?.functions) {
    features.push(...stcProduct.functions.split(',').map((f) => f.trim()).filter(Boolean));
  }
  return features;
}

function mergeSpecifications(
  xmlProduct: XMLProduct | undefined,
  stcProduct: STCProduct | undefined
): Record<string, string> {
  const specs: Record<string, string> = {};

  // XML physical attributes
  if (xmlProduct) {
    if (xmlProduct.height) specs['Height'] = xmlProduct.height;
    if (xmlProduct.length) specs['Length'] = xmlProduct.length;
    if (xmlProduct.diameter) specs['Diameter'] = xmlProduct.diameter;
    if (xmlProduct.weight) specs['Weight'] = xmlProduct.weight;
    if (xmlProduct.color) specs['Color'] = xmlProduct.color;
    if (xmlProduct.material) specs['Material'] = xmlProduct.material;
  }

  // STC attributes (fill gaps)
  if (stcProduct) {
    if (!specs['Color'] && stcProduct.color) specs['Color'] = stcProduct.color;
    if (!specs['Material'] && stcProduct.material) specs['Material'] = stcProduct.material;
    if (!specs['Weight'] && stcProduct.weight) specs['Weight'] = stcProduct.weight;
    if (!specs['Length'] && stcProduct.length) specs['Length'] = stcProduct.length;
    if (!specs['Width'] && stcProduct.width) specs['Width'] = stcProduct.width;
    if (!specs['Height'] && stcProduct.height) specs['Height'] = stcProduct.height;
    if (stcProduct.insertableLength) specs['Insertable Length'] = stcProduct.insertableLength;
    if (stcProduct.size) specs['Size'] = stcProduct.size;
    if (stcProduct.power) specs['Power'] = stcProduct.power;
    if (stcProduct.waterResistance) specs['Water Resistance'] = stcProduct.waterResistance;
    if (stcProduct.warranty) specs['Warranty'] = stcProduct.warranty;
  }

  return specs;
}

// ─── Public API ───

export interface MergeOptions {
  /** Only include products matching a specific source filter */
  source?: 'xml_active' | 'xml_inactive' | 'stc' | 'all';
}

export interface MergeResult {
  products: MergedProduct[];
  stats: {
    totalDbProducts: number;
    totalDbVariations: number;
    xmlActiveMatches: number;
    xmlInactiveMatches: number;
    stcMatches: number;
    noFeedMatch: number;
  };
}

export async function mergeAllSources(options: MergeOptions = {}): Promise<MergeResult> {
  const source = options.source || 'all';

  console.log('\n📦 Loading data sources...');

  // Load feeds in parallel
  const [xmlActiveMap, xmlInactiveMap, stcMap] = await Promise.all([
    loadXmlFeed('products-filtered.xml'),
    loadXmlFeed('inactive_products.xml'),
    loadStcFeed(),
  ]);

  // Connect to DB and fetch all data in parallel
  console.log('\n🗄️  Querying database...');
  const db = await getConnection();

  try {
    const [dbProducts, metaMap, taxMap, attachments, varCounts] = await Promise.all([
      fetchProducts(db),
      fetchProductMeta(db),
      fetchTaxonomies(db),
      fetchAttachments(db),
      fetchVariationCounts(db),
    ]);

    console.log(`  ✓ ${dbProducts.length} posts loaded from database`);

    // Separate products and variations
    const products = dbProducts.filter((p) => p.post_type === 'product');
    const variations = dbProducts.filter((p) => p.post_type === 'product_variation');

    console.log(`  ✓ ${products.length} products, ${variations.length} variations`);

    // Build merged records
    const stats = {
      totalDbProducts: products.length,
      totalDbVariations: variations.length,
      xmlActiveMatches: 0,
      xmlInactiveMatches: 0,
      stcMatches: 0,
      noFeedMatch: 0,
    };

    const merged: MergedProduct[] = [];

    // Process parent products
    for (const product of products) {
      const meta = metaMap.get(product.ID);
      const barcode = meta?.barcode || meta?.sku || '';

      // Look up in feeds
      const xmlActive = barcode ? xmlActiveMap.get(barcode) : undefined;
      const xmlInactive = barcode ? xmlInactiveMap.get(barcode) : undefined;
      const stc = barcode ? stcMap.get(barcode) : undefined;

      // Track matches
      const dataSources: string[] = ['db'];
      if (xmlActive) { dataSources.push('xml_active'); stats.xmlActiveMatches++; }
      if (xmlInactive) { dataSources.push('xml_inactive'); stats.xmlInactiveMatches++; }
      if (stc) { dataSources.push('stc'); stats.stcMatches++; }
      if (!xmlActive && !xmlInactive && !stc) stats.noFeedMatch++;

      // Source filter
      if (source === 'xml_active' && !xmlActive) continue;
      if (source === 'xml_inactive' && !xmlInactive) continue;
      if (source === 'stc' && !stc) continue;

      // Resolve taxonomies
      const taxes = taxMap.get(product.ID) || [];
      const categories = taxes.filter((t) => t.taxonomy === 'product_cat').map((t) => t.name);
      const brand = taxes.find((t) => t.taxonomy === 'product_brand')?.name || '';
      const material = taxes.find((t) => t.taxonomy === 'product_material')?.name || '';

      // Prefer XML feed for brand if DB is empty
      const mergedBrand =
        brand ||
        xmlActive?.manufacturer?.name ||
        xmlInactive?.manufacturer?.name ||
        stc?.brand ||
        '';

      // Resolve images
      const thumbnailUrl = meta?.thumbnail_id
        ? attachments.get(parseInt(meta.thumbnail_id, 10)) || ''
        : '';
      const galleryImageUrls = resolveImageUrls(meta?.gallery_ids, attachments);

      // Merge descriptions with priority: longest available
      const xmlPrimary = xmlActive || xmlInactive;
      const mergedDescription = mergeDescription(product.post_content, xmlPrimary, stc);
      const mergedFeatures = mergeFeatures(xmlPrimary, stc);
      const mergedSpecifications = mergeSpecifications(xmlPrimary, stc);

      merged.push({
        postId: product.ID,
        postType: 'product',
        parentId: null,
        sku: meta?.sku || '',
        barcode,
        title: decodeEntities(product.post_title),
        existingDescription: product.post_content,
        existingExcerpt: product.post_excerpt,
        mergedDescription,
        mergedFeatures,
        mergedSpecifications,
        brand: mergedBrand,
        categories,
        material,
        thumbnailUrl,
        galleryImageUrls,
        dataSources,
        variationCount: varCounts.get(product.ID) || 0,
      });
    }

    // Process variations (only for parents that made it through the filter)
    const parentIds = new Set(merged.map((m) => m.postId));

    for (const variation of variations) {
      if (!parentIds.has(variation.post_parent)) continue;

      const meta = metaMap.get(variation.ID);
      const barcode = meta?.barcode || meta?.sku || '';

      merged.push({
        postId: variation.ID,
        postType: 'product_variation',
        parentId: variation.post_parent,
        sku: meta?.sku || '',
        barcode,
        title: decodeEntities(variation.post_title),
        existingDescription: variation.post_content,
        existingExcerpt: variation.post_excerpt,
        mergedDescription: variation.post_content ? decodeEntities(variation.post_content) : '',
        mergedFeatures: [],
        mergedSpecifications: {},
        brand: '',
        categories: [],
        material: '',
        thumbnailUrl: '',
        galleryImageUrls: [],
        dataSources: ['db'],
        variationCount: 0,
      });
    }

    console.log(`\n✓ Merged ${merged.length} records`);
    return { products: merged, stats };
  } finally {
    await db.end();
  }
}
