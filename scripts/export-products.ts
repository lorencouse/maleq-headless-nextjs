/**
 * Pre-build export: MySQL → JSON files (products + posts)
 *
 * Queries the WordPress/WooCommerce database directly and writes
 * JSON files to .cache/ for use during `next build`.
 *
 * This eliminates ~35k+ individual GraphQL HTTP requests during static generation.
 *
 * Usage:
 *   bun run scripts/export-products.ts                # local DB
 *   bun run scripts/export-products.ts --remote       # production DB via SSH tunnel
 *   bun run scripts/export-products.ts --remote --validate  # export + validate vs GraphQL
 */
import { getConnection } from './lib/db';
import { parseProductAttributes, type ParsedAttribute } from '../lib/utils/php-unserialize';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Import shared specifications logic
// Note: We use relative path since this is a script, not an app module
import { extractSpecifications } from '../lib/products/specifications';
import { formatAttributeName } from '../lib/utils/woocommerce-format';

// ─── Types ───

interface DbProduct {
  ID: number;
  post_title: string;
  post_name: string;
  post_content: string;
  post_excerpt: string;
}

interface DbMeta {
  post_id: number;
  sku: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string | null;
  stock_qty: string | null;
  weight: string | null;
  length_val: string | null;
  width_val: string | null;
  height_val: string | null;
  thumbnail_id: string | null;
  gallery_ids: string | null;
  attributes_ser: string | null;
  purchase_note: string | null;
  featured: string | null;
  external_url: string | null;
  button_text: string | null;
}

interface DbTaxonomy {
  post_id: number;
  taxonomy: string;
  term_id: number;
  name: string;
  slug: string;
}

interface DbAttachment {
  ID: number;
  guid: string;
  post_title: string;
  post_excerpt: string;
}

interface DbVariation {
  ID: number;
  post_parent: number;
  post_title: string;
  post_name: string;
  post_content: string;
}

interface DbVariationMeta {
  post_id: number;
  sku: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string | null;
  stock_qty: string | null;
  weight: string | null;
  length_val: string | null;
  width_val: string | null;
  height_val: string | null;
  thumbnail_id: string | null;
}

interface DbVariationAttr {
  post_id: number;
  meta_key: string;
  meta_value: string;
}

interface DbReview {
  product_id: number;
  rating_count: number;
  average_rating: number;
}

// ─── Constants ───

const CACHE_DIR = join(process.cwd(), '.cache', 'products');
const SLUG_DIR = join(CACHE_DIR, 'by-slug');

const POSTS_CACHE_DIR = join(process.cwd(), '.cache', 'posts');
const POSTS_SLUG_DIR = join(POSTS_CACHE_DIR, 'by-slug');

const TAXONOMY_CACHE_DIR = join(process.cwd(), '.cache', 'taxonomies');
const SEARCH_CACHE_DIR = join(process.cwd(), '.cache', 'search');

const STOCK_MAP: Record<string, string> = {
  instock: 'IN_STOCK',
  outofstock: 'OUT_OF_STOCK',
  onbackorder: 'ON_BACKORDER',
};

const TYPE_MAP: Record<string, string> = {
  simple: 'SIMPLE',
  variable: 'VARIABLE',
  grouped: 'GROUPED',
  external: 'EXTERNAL',
};

// ─── Helpers ───

function formatDbPrice(val: string | null): string | null {
  if (!val || val === '') return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  return `$${num.toFixed(2)}`;
}

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

function log(msg: string) {
  console.log(`  ${msg}`);
}

// ─── SQL Queries ───

async function fetchProducts(db: any): Promise<DbProduct[]> {
  const [rows] = await db.query(
    `SELECT ID, post_title, post_name, post_content, post_excerpt
     FROM wp_posts
     WHERE post_type = 'product' AND post_status = 'publish'`
  );
  return rows as DbProduct[];
}

async function fetchProductMeta(db: any): Promise<Map<number, DbMeta>> {
  const [rows] = await db.query(
    `SELECT pm.post_id,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku,
      MAX(CASE WHEN pm.meta_key = '_price' THEN pm.meta_value END) AS price,
      MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) AS regular_price,
      MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) AS sale_price,
      MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) AS stock_status,
      MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) AS stock_qty,
      MAX(CASE WHEN pm.meta_key = '_weight' THEN pm.meta_value END) AS weight,
      MAX(CASE WHEN pm.meta_key = '_length' THEN pm.meta_value END) AS length_val,
      MAX(CASE WHEN pm.meta_key = '_width' THEN pm.meta_value END) AS width_val,
      MAX(CASE WHEN pm.meta_key = '_height' THEN pm.meta_value END) AS height_val,
      MAX(CASE WHEN pm.meta_key = '_thumbnail_id' THEN pm.meta_value END) AS thumbnail_id,
      MAX(CASE WHEN pm.meta_key = '_product_image_gallery' THEN pm.meta_value END) AS gallery_ids,
      MAX(CASE WHEN pm.meta_key = '_product_attributes' THEN pm.meta_value END) AS attributes_ser,
      MAX(CASE WHEN pm.meta_key = '_purchase_note' THEN pm.meta_value END) AS purchase_note,
      MAX(CASE WHEN pm.meta_key = '_featured' THEN pm.meta_value END) AS featured,
      MAX(CASE WHEN pm.meta_key = '_product_url' THEN pm.meta_value END) AS external_url,
      MAX(CASE WHEN pm.meta_key = '_button_text' THEN pm.meta_value END) AS button_text
     FROM wp_postmeta pm
     INNER JOIN wp_posts p ON pm.post_id = p.ID
     WHERE p.post_type = 'product' AND p.post_status = 'publish'
       AND pm.meta_key IN ('_sku','_price','_regular_price','_sale_price','_stock_status','_stock',
         '_weight','_length','_width','_height','_thumbnail_id','_product_image_gallery',
         '_product_attributes','_purchase_note','_featured','_product_url','_button_text')
     GROUP BY pm.post_id`
  );
  const map = new Map<number, DbMeta>();
  for (const row of rows as DbMeta[]) {
    map.set(row.post_id, row);
  }
  return map;
}

async function fetchTaxonomies(db: any): Promise<Map<number, DbTaxonomy[]>> {
  const [rows] = await db.query(
    `SELECT tr.object_id AS post_id, tt.taxonomy, t.term_id, t.name, t.slug
     FROM wp_term_relationships tr
     JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
     JOIN wp_terms t ON tt.term_id = t.term_id
     INNER JOIN wp_posts p ON tr.object_id = p.ID
     WHERE p.post_type = 'product' AND p.post_status = 'publish'
       AND tt.taxonomy IN ('product_cat','product_tag','product_brand','product_material','product_type','product_visibility')`
  );
  const map = new Map<number, DbTaxonomy[]>();
  for (const row of rows as DbTaxonomy[]) {
    const list = map.get(row.post_id) || [];
    list.push(row);
    map.set(row.post_id, list);
  }
  return map;
}

async function fetchAttachments(db: any): Promise<Map<number, DbAttachment>> {
  const [rows] = await db.query(
    `SELECT ID, guid, post_title, post_excerpt
     FROM wp_posts
     WHERE post_type = 'attachment' AND post_mime_type LIKE 'image/%'`
  );
  const map = new Map<number, DbAttachment>();
  for (const row of rows as DbAttachment[]) {
    map.set(row.ID, row);
  }
  return map;
}

async function fetchVariations(db: any): Promise<Map<number, DbVariation[]>> {
  const [rows] = await db.query(
    `SELECT v.ID, v.post_parent, v.post_title, v.post_name, v.post_content
     FROM wp_posts v
     INNER JOIN wp_posts p ON v.post_parent = p.ID
     WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
       AND p.post_type = 'product' AND p.post_status = 'publish'`
  );
  const map = new Map<number, DbVariation[]>();
  for (const row of rows as DbVariation[]) {
    const list = map.get(row.post_parent) || [];
    list.push(row);
    map.set(row.post_parent, list);
  }
  return map;
}

async function fetchVariationMeta(db: any): Promise<Map<number, DbVariationMeta>> {
  const [rows] = await db.query(
    `SELECT pm.post_id,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku,
      MAX(CASE WHEN pm.meta_key = '_price' THEN pm.meta_value END) AS price,
      MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) AS regular_price,
      MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) AS sale_price,
      MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) AS stock_status,
      MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) AS stock_qty,
      MAX(CASE WHEN pm.meta_key = '_weight' THEN pm.meta_value END) AS weight,
      MAX(CASE WHEN pm.meta_key = '_length' THEN pm.meta_value END) AS length_val,
      MAX(CASE WHEN pm.meta_key = '_width' THEN pm.meta_value END) AS width_val,
      MAX(CASE WHEN pm.meta_key = '_height' THEN pm.meta_value END) AS height_val,
      MAX(CASE WHEN pm.meta_key = '_thumbnail_id' THEN pm.meta_value END) AS thumbnail_id
     FROM wp_postmeta pm
     INNER JOIN wp_posts v ON pm.post_id = v.ID
     WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
       AND pm.meta_key IN ('_sku','_price','_regular_price','_sale_price','_stock_status','_stock',
         '_weight','_length','_width','_height','_thumbnail_id')
     GROUP BY pm.post_id`
  );
  const map = new Map<number, DbVariationMeta>();
  for (const row of rows as DbVariationMeta[]) {
    map.set(row.post_id, row);
  }
  return map;
}

async function fetchVariationAttributes(db: any): Promise<Map<number, DbVariationAttr[]>> {
  const [rows] = await db.query(
    `SELECT pm.post_id, pm.meta_key, pm.meta_value
     FROM wp_postmeta pm
     INNER JOIN wp_posts v ON pm.post_id = v.ID
     WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
       AND pm.meta_key LIKE 'attribute_%'`
  );
  const map = new Map<number, DbVariationAttr[]>();
  for (const row of rows as DbVariationAttr[]) {
    const list = map.get(row.post_id) || [];
    list.push(row);
    map.set(row.post_id, list);
  }
  return map;
}

async function fetchReviews(db: any): Promise<Map<number, DbReview>> {
  const [rows] = await db.query(
    `SELECT product_id, rating_count, average_rating
     FROM wp_wc_product_meta_lookup
     INNER JOIN wp_posts p ON product_id = p.ID
     WHERE p.post_type = 'product' AND p.post_status = 'publish'`
  );
  const map = new Map<number, DbReview>();
  for (const row of rows as DbReview[]) {
    map.set(row.product_id, row);
  }
  return map;
}

// ─── Post SQL Queries ───

interface DbPost {
  ID: number;
  post_title: string;
  post_name: string;
  post_content: string;
  post_excerpt: string;
  post_date: string;
  post_modified: string;
  post_author: number;
}

interface DbAuthor {
  ID: number;
  user_nicename: string;
  display_name: string;
}

interface DbComment {
  comment_ID: number;
  comment_post_ID: number;
  comment_author: string;
  comment_author_email: string;
  comment_date: string;
  comment_content: string;
  comment_parent: number;
}

interface DbPostTaxonomy {
  post_id: number;
  taxonomy: string;
  term_id: number;
  name: string;
  slug: string;
}

async function fetchPosts(db: any): Promise<DbPost[]> {
  const [rows] = await db.query(
    `SELECT ID, post_title, post_name, post_content, post_excerpt,
            post_date, post_modified, post_author
     FROM wp_posts
     WHERE post_type = 'post' AND post_status = 'publish'`
  );
  return rows as DbPost[];
}

async function fetchAuthors(db: any): Promise<Map<number, DbAuthor>> {
  const [rows] = await db.query(
    `SELECT ID, user_nicename, display_name FROM wp_users`
  );
  const map = new Map<number, DbAuthor>();
  for (const row of rows as DbAuthor[]) {
    map.set(row.ID, row);
  }
  return map;
}

async function fetchPostMeta(db: any): Promise<Map<number, string | null>> {
  // We only need _thumbnail_id for posts
  const [rows] = await db.query(
    `SELECT pm.post_id, pm.meta_value AS thumbnail_id
     FROM wp_postmeta pm
     INNER JOIN wp_posts p ON pm.post_id = p.ID
     WHERE p.post_type = 'post' AND p.post_status = 'publish'
       AND pm.meta_key = '_thumbnail_id'`
  );
  const map = new Map<number, string | null>();
  for (const row of rows as { post_id: number; thumbnail_id: string }[]) {
    map.set(row.post_id, row.thumbnail_id);
  }
  return map;
}

async function fetchPostTaxonomies(db: any): Promise<Map<number, DbPostTaxonomy[]>> {
  const [rows] = await db.query(
    `SELECT tr.object_id AS post_id, tt.taxonomy, t.term_id, t.name, t.slug
     FROM wp_term_relationships tr
     JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
     JOIN wp_terms t ON tt.term_id = t.term_id
     INNER JOIN wp_posts p ON tr.object_id = p.ID
     WHERE p.post_type = 'post' AND p.post_status = 'publish'
       AND tt.taxonomy IN ('category', 'post_tag')`
  );
  const map = new Map<number, DbPostTaxonomy[]>();
  for (const row of rows as DbPostTaxonomy[]) {
    const list = map.get(row.post_id) || [];
    list.push(row);
    map.set(row.post_id, list);
  }
  return map;
}

async function fetchComments(db: any): Promise<Map<number, DbComment[]>> {
  const [rows] = await db.query(
    `SELECT comment_ID, comment_post_ID, comment_author, comment_author_email,
            comment_date, comment_content, comment_parent
     FROM wp_comments
     WHERE comment_approved = '1'
       AND comment_post_ID IN (SELECT ID FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish')
     ORDER BY comment_date ASC`
  );
  const map = new Map<number, DbComment[]>();
  for (const row of rows as DbComment[]) {
    const list = map.get(row.comment_post_ID) || [];
    list.push(row);
    map.set(row.comment_post_ID, list);
  }
  return map;
}

// ─── Taxonomy SQL Queries ───

interface DbTermWithMeta {
  term_id: number;
  name: string;
  slug: string;
  description: string;
  parent: number;
  count: number;
  thumbnail_id: number | null;
}

async function fetchProductCategories(db: any): Promise<DbTermWithMeta[]> {
  const [rows] = await db.query(
    `SELECT t.term_id, t.name, t.slug, tt.description, tt.parent, tt.count,
            CAST(tm.meta_value AS UNSIGNED) AS thumbnail_id
     FROM wp_term_taxonomy tt
     JOIN wp_terms t ON tt.term_id = t.term_id
     LEFT JOIN wp_termmeta tm ON t.term_id = tm.term_id AND tm.meta_key = 'thumbnail_id'
     WHERE tt.taxonomy = 'product_cat' AND tt.count > 0
     ORDER BY t.name`
  );
  return rows as DbTermWithMeta[];
}

interface DbSimpleTerm {
  term_id: number;
  name: string;
  slug: string;
  description: string;
  count: number;
}

async function fetchTermsByTaxonomy(db: any, taxonomy: string): Promise<DbSimpleTerm[]> {
  const [rows] = await db.query(
    `SELECT t.term_id, t.name, t.slug, tt.description, tt.count
     FROM wp_term_taxonomy tt
     JOIN wp_terms t ON tt.term_id = t.term_id
     WHERE tt.taxonomy = ? AND tt.count > 0
     ORDER BY t.name`,
    [taxonomy]
  );
  return rows as DbSimpleTerm[];
}

async function fetchBlogTermsByTaxonomy(db: any, taxonomy: string): Promise<DbSimpleTerm[]> {
  const [rows] = await db.query(
    `SELECT t.term_id, t.name, t.slug, tt.description, tt.count
     FROM wp_term_taxonomy tt
     JOIN wp_terms t ON tt.term_id = t.term_id
     WHERE tt.taxonomy = ? AND tt.count > 0
     ORDER BY t.name`,
    [taxonomy]
  );
  return rows as DbSimpleTerm[];
}

// ─── Assembly ───

function resolveImage(attachmentId: string | null, attachments: Map<number, DbAttachment>, fallbackAlt: string) {
  if (!attachmentId) return null;
  const id = parseInt(attachmentId, 10);
  const att = attachments.get(id);
  if (!att) return null;
  return {
    id: encodeId('post', id),
    url: att.guid,
    altText: att.post_excerpt || att.post_title || fallbackAlt,
  };
}

function buildAttributes(parsedAttrs: ParsedAttribute[], taxonomies: DbTaxonomy[]) {
  // For taxonomy-based attributes, get the option values from term assignments
  const termsByTaxonomy = new Map<string, string[]>();
  for (const tax of taxonomies) {
    // pa_color, pa_size, etc. are stored as taxonomy names
    if (tax.taxonomy.startsWith('pa_')) {
      const list = termsByTaxonomy.get(tax.taxonomy) || [];
      list.push(tax.name);
      termsByTaxonomy.set(tax.taxonomy, list);
    }
  }

  return parsedAttrs.map((attr) => {
    let options: string[];
    if (attr.isTaxonomy) {
      // Use actual term names from taxonomy relationships
      options = termsByTaxonomy.get(attr.name) || [];
    } else {
      // Custom attributes: value is pipe-separated
      options = attr.value
        .split(/\s*\|\s*/)
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    }

    return {
      name: attr.name,
      options,
      visible: attr.isVisible,
      variation: attr.isVariation,
    };
  });
}

// ─── Main ───

async function main() {
  const startTime = performance.now();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Product Export: MySQL → JSON Cache                ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const db = await getConnection();

  try {
    // Phase 1: Fetch all data
    console.log('📥 Fetching data from database...');

    const t1 = performance.now();
    const [products, metaMap, taxMap, attachments, variationsMap, varMetaMap, varAttrMap, reviewMap] =
      await Promise.all([
        fetchProducts(db),
        fetchProductMeta(db),
        fetchTaxonomies(db),
        fetchAttachments(db),
        fetchVariations(db),
        fetchVariationMeta(db),
        fetchVariationAttributes(db),
        fetchReviews(db),
      ]);
    log(`Fetched in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
    log(`Products: ${products.length.toLocaleString()}`);
    log(`Attachments: ${attachments.size.toLocaleString()}`);
    log(`Variations: ${[...variationsMap.values()].reduce((n, v) => n + v.length, 0).toLocaleString()}`);
    console.log();

    // Phase 2: Prepare output directory
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true });
    }
    mkdirSync(SLUG_DIR, { recursive: true });

    // Phase 3: Assemble and write each product
    console.log('🔨 Assembling products...');
    const t2 = performance.now();
    const slugs: string[] = [];
    let written = 0;

    for (const product of products) {
      const meta = metaMap.get(product.ID);
      const taxes = taxMap.get(product.ID) || [];
      const review = reviewMap.get(product.ID);
      const productVariations = variationsMap.get(product.ID) || [];

      // Determine product type from taxonomy
      const typeTax = taxes.find((t) => t.taxonomy === 'product_type');
      const productType = TYPE_MAP[typeTax?.slug || 'simple'] || 'SIMPLE';
      const isVariable = productType === 'VARIABLE';

      // Check featured status from product_visibility taxonomy
      const isFeatured = taxes.some((t) => t.taxonomy === 'product_visibility' && t.slug === 'featured');

      // Stock status
      const stockStatus = STOCK_MAP[meta?.stock_status || 'outofstock'] || 'OUT_OF_STOCK';
      const stockQuantity = meta?.stock_qty ? parseInt(meta.stock_qty, 10) : null;

      // Taxonomies by type
      const categories = taxes
        .filter((t) => t.taxonomy === 'product_cat')
        .map((t) => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
      const tags = taxes
        .filter((t) => t.taxonomy === 'product_tag')
        .map((t) => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
      const brands = taxes
        .filter((t) => t.taxonomy === 'product_brand')
        .map((t) => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));
      const materials = taxes
        .filter((t) => t.taxonomy === 'product_material')
        .map((t) => ({ id: encodeId('term', t.term_id), name: t.name, slug: t.slug }));

      // Images
      const primaryImage = resolveImage(meta?.thumbnail_id || null, attachments, product.post_title);
      const galleryIds = (meta?.gallery_ids || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id);
      const galleryImages = galleryIds
        .map((gid) => {
          const att = attachments.get(parseInt(gid, 10));
          if (!att) return null;
          return {
            url: att.guid,
            altText: att.post_excerpt || att.post_title || product.post_title,
          };
        })
        .filter((img): img is NonNullable<typeof img> => img !== null);

      // Gallery array (primary + gallery)
      const gallery = [
        ...(primaryImage
          ? [{ id: primaryImage.id, url: primaryImage.url, altText: primaryImage.altText, isPrimary: true }]
          : []),
        ...galleryIds
          .map((gid, idx) => {
            const att = attachments.get(parseInt(gid, 10));
            if (!att) return null;
            return {
              id: encodeId('post', parseInt(gid, 10)),
              url: att.guid,
              altText: att.post_excerpt || att.post_title || product.post_title,
              isPrimary: false,
            };
          })
          .filter((img): img is NonNullable<typeof img> => img !== null),
      ];

      // Attributes
      const parsedAttrs = meta?.attributes_ser ? parseProductAttributes(meta.attributes_ser) : [];
      const attributes = buildAttributes(parsedAttrs, taxes);

      // Variations
      const variations = productVariations.map((v) => {
        const vMeta = varMetaMap.get(v.ID);
        const vAttrs = varAttrMap.get(v.ID) || [];
        const vImage = resolveImage(vMeta?.thumbnail_id || null, attachments, v.post_title);

        return {
          id: encodeId('product', v.ID),
          databaseId: v.ID,
          name: v.post_title,
          sku: vMeta?.sku || null,
          description: v.post_content || null,
          price: formatDbPrice(vMeta?.price) || null,
          regularPrice: formatDbPrice(vMeta?.regular_price) || null,
          salePrice: formatDbPrice(vMeta?.sale_price) || null,
          stockStatus: STOCK_MAP[vMeta?.stock_status || 'outofstock'] || 'OUT_OF_STOCK',
          stockQuantity: vMeta?.stock_qty ? parseInt(vMeta.stock_qty, 10) : null,
          weight: vMeta?.weight || null,
          length: vMeta?.length_val || null,
          width: vMeta?.width_val || null,
          height: vMeta?.height_val || null,
          attributes: vAttrs.map((a) => ({
            name: formatAttributeName(a.meta_key.replace('attribute_', '')),
            value: a.meta_value,
          })),
          image: vImage ? { url: vImage.url, altText: vImage.altText } : null,
        };
      });

      // Compute price for variable products (range)
      let price = formatDbPrice(meta?.price);
      let regularPrice = formatDbPrice(meta?.regular_price);
      let salePrice = formatDbPrice(meta?.sale_price);

      if (isVariable && variations.length > 0) {
        const prices = variations
          .map((v) => v.price)
          .filter((p): p is string => p !== null)
          .map((p) => parseFloat(p.replace('$', '')))
          .filter((n) => !isNaN(n));
        if (prices.length > 0) {
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          price = min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} - $${max.toFixed(2)}`;
        }
      }

      // onSale
      const onSale = !!(
        salePrice &&
        regularPrice &&
        parseFloat(salePrice.replace('$', '')) < parseFloat(regularPrice.replace('$', ''))
      );

      // Specifications (using shared module)
      const specifications = extractSpecifications(
        {
          sku: meta?.sku || null,
          weight: meta?.weight || null,
          length: meta?.length_val || null,
          width: meta?.width_val || null,
          height: meta?.height_val || null,
          stockStatus,
          stockQuantity,
          brands,
          categories,
          tags,
          attributes,
        },
        isVariable
      );

      // Build EnhancedProduct
      const enhanced = {
        id: encodeId('post', product.ID),
        databaseId: product.ID,
        name: product.post_title,
        slug: product.post_name,
        description: product.post_content || null,
        shortDescription: product.post_excerpt || null,
        sku: meta?.sku || null,
        price,
        regularPrice,
        salePrice,
        onSale,
        stockStatus,
        stockQuantity,
        weight: meta?.weight || null,
        length: meta?.length_val || null,
        width: meta?.width_val || null,
        height: meta?.height_val || null,
        image: primaryImage ? { url: primaryImage.url, altText: primaryImage.altText } : null,
        galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
        categories,
        tags: tags.length > 0 ? tags : undefined,
        brands,
        materials: materials.length > 0 ? materials : undefined,
        type: productType,
        averageRating: Number(review?.average_rating) || 0,
        reviewCount: Number(review?.rating_count) || 0,
        viewCount: 0,
        popularityScore: 0,
        attributes: attributes.length > 0 ? attributes : undefined,
        variations: variations.length > 0 ? variations : undefined,
        specifications,
        gallery,
        dimensions: {
          weight: meta?.weight || null,
          length: meta?.length_val || null,
          width: meta?.width_val || null,
          height: meta?.height_val || null,
        },
        featured: isFeatured,
        purchaseNote: meta?.purchase_note || null,
        externalUrl: meta?.external_url || null,
        buttonText: meta?.button_text || null,
      };

      // Write individual product file
      writeFileSync(join(SLUG_DIR, `${product.post_name}.json`), JSON.stringify(enhanced));
      slugs.push(product.post_name);
      written++;

      if (written % 5000 === 0) {
        log(`${written.toLocaleString()} / ${products.length.toLocaleString()} products written`);
      }
    }

    // Write index file
    writeFileSync(
      join(CACHE_DIR, 'index.json'),
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        count: slugs.length,
        slugs,
      })
    );

    const assemblyTime = (performance.now() - t2) / 1000;
    log(`${written.toLocaleString()} products written in ${assemblyTime.toFixed(1)}s`);
    console.log();

    // ─── Phase 4: Export Posts ───
    // DISABLED: Raw post_content from MySQL doesn't render WordPress reusable blocks
    // (<!-- wp:block {"ref":ID} /-->). Posts fall back to WPGraphQL at runtime, which
    // properly expands reusable blocks into HTML. Re-enable once block expansion is
    // implemented in the export script.
    console.log('⏭️  Skipping post export (reusable blocks require WPGraphQL rendering)');
    console.log();

    // ─── Phase 5: Export Taxonomies ───
    console.log('📥 Fetching taxonomies from database...');
    const t5 = performance.now();

    const [dbCategories, dbBrands, dbMaterials, dbColors, dbBlogCategories, dbBlogTags] = await Promise.all([
      fetchProductCategories(db),
      fetchTermsByTaxonomy(db, 'product_brand'),
      fetchTermsByTaxonomy(db, 'product_material'),
      fetchTermsByTaxonomy(db, 'pa_color'),
      fetchBlogTermsByTaxonomy(db, 'category'),
      fetchBlogTermsByTaxonomy(db, 'post_tag'),
    ]);

    log(`Taxonomies fetched in ${((performance.now() - t5) / 1000).toFixed(1)}s`);
    log(`Product categories: ${dbCategories.length}, Brands: ${dbBrands.length}, Materials: ${dbMaterials.length}`);
    log(`Colors: ${dbColors.length}, Blog categories: ${dbBlogCategories.length}, Blog tags: ${dbBlogTags.length}`);
    console.log();

    // Prepare taxonomy output directory
    mkdirSync(TAXONOMY_CACHE_DIR, { recursive: true });
    mkdirSync(SEARCH_CACHE_DIR, { recursive: true });

    console.log('🔨 Assembling taxonomy caches...');
    const t6 = performance.now();

    // 1. Flat product categories (matches ProductCategory type from GraphQL)
    const flatCategories = dbCategories.map((cat) => ({
      id: encodeId('term', cat.term_id),
      name: cat.name,
      slug: cat.slug,
      description: cat.description || undefined,
      count: cat.count,
      image: cat.thumbnail_id ? (() => {
        const att = attachments.get(cat.thumbnail_id);
        return att ? { sourceUrl: att.guid } : undefined;
      })() : undefined,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'product-categories.json'), JSON.stringify(flatCategories));
    log(`product-categories.json: ${flatCategories.length} categories`);

    // 2. Hierarchical categories (tree structure)
    interface HierarchicalCategoryExport {
      id: string;
      name: string;
      slug: string;
      count: number;
      image?: string | null;
      children: HierarchicalCategoryExport[];
    }

    const categoryMap = new Map<number, DbTermWithMeta & { childIds: number[] }>();
    for (const cat of dbCategories) {
      categoryMap.set(cat.term_id, { ...cat, childIds: [] });
    }
    // Build parent-child links
    for (const cat of dbCategories) {
      if (cat.parent > 0) {
        const parent = categoryMap.get(cat.parent);
        if (parent) {
          parent.childIds.push(cat.term_id);
        }
      }
    }

    function buildCategoryTree(termId: number): HierarchicalCategoryExport | null {
      const cat = categoryMap.get(termId);
      if (!cat || cat.count <= 0) return null;
      const imageUrl = cat.thumbnail_id ? (() => {
        const att = attachments.get(cat.thumbnail_id);
        return att ? att.guid : null;
      })() : null;
      return {
        id: encodeId('term', cat.term_id),
        name: cat.name,
        slug: cat.slug,
        count: cat.count,
        image: imageUrl,
        children: cat.childIds
          .map(buildCategoryTree)
          .filter((c): c is HierarchicalCategoryExport => c !== null)
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    // Top-level categories (parent = 0)
    const hierarchicalCategories = dbCategories
      .filter((cat) => cat.parent === 0)
      .map((cat) => buildCategoryTree(cat.term_id))
      .filter((c): c is HierarchicalCategoryExport => c !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    writeFileSync(join(TAXONOMY_CACHE_DIR, 'hierarchical-categories.json'), JSON.stringify(hierarchicalCategories));
    log(`hierarchical-categories.json: ${hierarchicalCategories.length} top-level categories`);

    // 3. Brands (with descriptions, matches Brand type)
    const brands = dbBrands.map((b) => ({
      id: encodeId('term', b.term_id),
      name: b.name,
      slug: b.slug,
      count: b.count,
      description: b.description || null,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'brands.json'), JSON.stringify(brands));
    log(`brands.json: ${brands.length} brands`);

    // 4. Materials
    const materials = dbMaterials.map((m) => ({
      id: encodeId('term', m.term_id),
      name: m.name,
      slug: m.slug,
      count: m.count,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'materials.json'), JSON.stringify(materials));
    log(`materials.json: ${materials.length} materials`);

    // 5. Colors
    const colors = dbColors.map((c) => ({
      id: encodeId('term', c.term_id),
      name: c.name,
      slug: c.slug,
      count: c.count,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'colors.json'), JSON.stringify(colors));
    log(`colors.json: ${colors.length} colors`);

    // 6. Blog categories
    const blogCategories = dbBlogCategories.map((c) => ({
      id: encodeId('term', c.term_id),
      name: c.name,
      slug: c.slug,
      count: c.count,
      description: c.description || null,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'blog-categories.json'), JSON.stringify(blogCategories));
    log(`blog-categories.json: ${blogCategories.length} blog categories`);

    // 7. Blog tags
    const blogTags = dbBlogTags.map((t) => ({
      id: encodeId('term', t.term_id),
      name: t.name,
      slug: t.slug,
      count: t.count,
    }));
    writeFileSync(join(TAXONOMY_CACHE_DIR, 'blog-tags.json'), JSON.stringify(blogTags));
    log(`blog-tags.json: ${blogTags.length} blog tags`);

    // 8. Search vocabulary (product names + brand names + category names)
    // Product names are already in memory from the products loop — collect them
    const productNames = products.map((p) => p.post_title);
    const brandNames = dbBrands.map((b) => b.name);
    const categoryNames = dbCategories.map((c) => c.name);

    const vocabulary = {
      exportedAt: new Date().toISOString(),
      productNames,
      brandNames,
      categoryNames,
    };
    writeFileSync(join(SEARCH_CACHE_DIR, 'vocabulary.json'), JSON.stringify(vocabulary));
    log(`vocabulary.json: ${productNames.length} products, ${brandNames.length} brands, ${categoryNames.length} categories`);

    const taxonomyTime = (performance.now() - t6) / 1000;
    log(`Taxonomy caches written in ${taxonomyTime.toFixed(1)}s`);
    console.log();

    // ─── Phase 6: Summary ───
    const totalTime = (performance.now() - startTime) / 1000;
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Export complete in ${totalTime.toFixed(1)}s`);
    console.log(`   Products: ${written.toLocaleString()}`);
    console.log(`   Posts: ${postsWritten.toLocaleString()}`);
    console.log(`   Taxonomies: ${flatCategories.length} categories, ${brands.length} brands, ${materials.length} materials, ${colors.length} colors`);
    console.log(`   Blog: ${blogCategories.length} categories, ${blogTags.length} tags`);
    console.log(`   Vocabulary: ${productNames.length.toLocaleString()} product names`);
    console.log(`   Output: .cache/products/ + .cache/posts/ + .cache/taxonomies/ + .cache/search/`);

    // Validation mode
    if (process.argv.includes('--validate')) {
      console.log('\n🔍 Validation mode: comparing random products against GraphQL...');
      await validate(slugs);
    }
  } finally {
    await db.end();
  }
}

// ─── Validation ───

async function validate(slugs: string[]) {
  const GRAPHQL_URL = process.env.NEXT_PUBLIC_WORDPRESS_API_URL || 'https://wp.maleq.com/graphql';
  const SAMPLE = 5;

  // Pick random slugs
  const sample = [];
  for (let i = 0; i < SAMPLE && slugs.length > 0; i++) {
    const idx = Math.floor(Math.random() * slugs.length);
    sample.push(slugs[idx]);
  }

  const query = `query($slug: ID!) {
    product(id: $slug, idType: SLUG) {
      databaseId name slug sku
      ... on SimpleProduct { price regularPrice salePrice stockStatus }
      ... on VariableProduct { price regularPrice salePrice stockStatus }
    }
  }`;

  let mismatches = 0;
  for (const slug of sample) {
    const jsonPath = join(SLUG_DIR, `${slug}.json`);
    const dbProduct = JSON.parse(require('fs').readFileSync(jsonPath, 'utf-8'));

    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { slug } }),
    });
    const { data } = await res.json();
    const gqlProduct = data?.product;

    if (!gqlProduct) {
      console.log(`   ⚠️  ${slug}: not found in GraphQL`);
      continue;
    }

    const checks = [
      ['name', dbProduct.name, gqlProduct.name],
      ['sku', dbProduct.sku, gqlProduct.sku],
      ['price', dbProduct.price, gqlProduct.price],
      ['stockStatus', dbProduct.stockStatus, gqlProduct.stockStatus],
    ] as const;

    const failures = checks.filter(([, db, gql]) => db !== gql);
    if (failures.length === 0) {
      console.log(`   ✅ ${slug}: matches`);
    } else {
      mismatches++;
      console.log(`   ❌ ${slug}: mismatches:`);
      for (const [field, db, gql] of failures) {
        console.log(`      ${field}: DB="${db}" vs GQL="${gql}"`);
      }
    }
  }

  if (mismatches === 0) {
    console.log(`\n   All ${SAMPLE} samples match! ✅`);
  } else {
    console.log(`\n   ⚠️  ${mismatches}/${SAMPLE} samples had mismatches`);
  }
}

main().catch((err) => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});
