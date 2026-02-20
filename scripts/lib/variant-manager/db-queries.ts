/**
 * DB Queries — all read queries for the variant manager pipeline.
 *
 * Consolidates query patterns from split-variation-products.ts,
 * fix-duplicate-variations.ts, and enforce-single-attribute.ts.
 */

import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { ParentProduct, VariationRecord, FeedIndex } from './types';
import { phpUnserialize } from '../php-unserialize';
import { resolveFeedProduct, resolveWarehouseSku } from './feed-index';
import { sqlInList, chunk } from './utils';

/**
 * Load all variable parent products with 3+ variations.
 */
export async function loadVariableParents(
  db: Connection,
  opts: { parentId?: number; limit?: number }
): Promise<ParentProduct[]> {
  let query = `
    SELECT p.ID as id, p.post_title as title, p.post_name as slug,
           p.post_status as status, COUNT(v.ID) as varCount
    FROM wp_posts p
    JOIN wp_posts v ON v.post_parent = p.ID AND v.post_type = 'product_variation'
    WHERE p.post_type = 'product' AND p.post_status = 'publish'
  `;
  const params: (string | number)[] = [];

  if (opts.parentId) {
    query += ` AND p.ID = ?`;
    params.push(opts.parentId);
  }

  query += ` GROUP BY p.ID HAVING varCount >= 3 ORDER BY varCount DESC`;

  if (opts.limit) {
    query += ` LIMIT ?`;
    params.push(opts.limit);
  }

  const [rows] = await db.query<RowDataPacket[]>(query, params);
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    status: r.status,
    varCount: r.varCount,
  }));
}

/**
 * Load all variable parent products (including those with fewer variations).
 * For use by audit when checking all parents.
 */
export async function loadAllVariableParents(
  db: Connection,
  opts: { parentId?: number; limit?: number }
): Promise<ParentProduct[]> {
  let query = `
    SELECT p.ID as id, p.post_title as title, p.post_name as slug,
           p.post_status as status, COUNT(v.ID) as varCount
    FROM wp_posts p
    JOIN wp_posts v ON v.post_parent = p.ID AND v.post_type = 'product_variation'
    WHERE p.post_type = 'product' AND p.post_status = 'publish'
  `;
  const params: (string | number)[] = [];

  if (opts.parentId) {
    query += ` AND p.ID = ?`;
    params.push(opts.parentId);
  }

  query += ` GROUP BY p.ID HAVING varCount >= 1 ORDER BY varCount DESC`;

  if (opts.limit) {
    query += ` LIMIT ?`;
    params.push(opts.limit);
  }

  const [rows] = await db.query<RowDataPacket[]>(query, params);
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    status: r.status,
    varCount: r.varCount,
  }));
}

/**
 * Batch-load variations with all relevant meta for a set of parent IDs.
 * Returns a Map of parentId → VariationRecord[].
 */
export async function loadVariationsWithMeta(
  db: Connection,
  parentIds: number[],
  feedIndex: FeedIndex
): Promise<Map<number, VariationRecord[]>> {
  if (parentIds.length === 0) return new Map();

  const result = new Map<number, VariationRecord[]>();

  // Process in chunks to avoid too-large IN clauses
  for (const idChunk of chunk(parentIds, 500)) {
    const inClause = sqlInList(idChunk);

    // Load variation posts
    const [varRows] = await db.query<RowDataPacket[]>(`
      SELECT v.ID as id, v.post_parent as parentId, v.post_title as title,
             v.post_name as slug, LEFT(v.post_excerpt, 500) as excerpt,
             v.post_status as status
      FROM wp_posts v
      WHERE v.post_type = 'product_variation'
        AND v.post_parent IN ${inClause}
      ORDER BY v.post_parent, v.ID
    `);

    if (varRows.length === 0) continue;

    const varIds = varRows.map(v => v.id);
    const varInClause = sqlInList(varIds);

    // Batch-load meta: _sku, _wt_sku, _regular_price, attribute_pa_*
    const [metaRows] = await db.query<RowDataPacket[]>(`
      SELECT post_id, meta_key, meta_value
      FROM wp_postmeta
      WHERE post_id IN ${varInClause}
        AND (
          meta_key IN ('_sku', '_wt_sku', '_regular_price')
          OR meta_key LIKE 'attribute_pa_%'
        )
        AND meta_value IS NOT NULL AND meta_value != ''
    `);

    // Index meta by variation ID
    const metaByVar = new Map<number, Map<string, string>>();
    for (const r of metaRows) {
      if (!metaByVar.has(r.post_id)) metaByVar.set(r.post_id, new Map());
      metaByVar.get(r.post_id)!.set(r.meta_key, r.meta_value);
    }

    // Build VariationRecord objects
    for (const v of varRows) {
      const meta = metaByVar.get(v.id) || new Map<string, string>();
      const dbSku = meta.get('_sku') || '';
      const dbWtSku = meta.get('_wt_sku') || '';
      const priceStr = meta.get('_regular_price') || '';
      const regularPrice = priceStr ? parseFloat(priceStr) : 0;

      const warehouseSku = resolveWarehouseSku(feedIndex, dbWtSku, dbSku);

      // Extract attribute_pa_* entries
      const attrs = new Map<string, string>();
      for (const [key, value] of meta) {
        if (key.startsWith('attribute_pa_')) {
          attrs.set(key, value);
        }
      }

      const feedProduct = resolveFeedProduct(feedIndex, warehouseSku, dbSku);

      const record: VariationRecord = {
        id: v.id,
        parentId: v.parentId,
        title: v.title,
        slug: v.slug,
        excerpt: v.excerpt || '',
        status: v.status,
        sku: dbSku,
        warehouseSku,
        regularPrice: (regularPrice > 0 && isFinite(regularPrice)) ? regularPrice : 0,
        attrs,
        feedProduct,
      };

      if (!result.has(v.parentId)) result.set(v.parentId, []);
      result.get(v.parentId)!.push(record);
    }
  }

  return result;
}

/**
 * Load deserialized _product_attributes for given parent IDs.
 * Returns Map<parentId, deserializedAttributes>.
 */
export async function loadParentAttributes(
  db: Connection,
  parentIds: number[]
): Promise<Map<number, Record<string, any>>> {
  if (parentIds.length === 0) return new Map();

  const inClause = sqlInList(parentIds);
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT post_id, meta_value
    FROM wp_postmeta
    WHERE post_id IN ${inClause}
      AND meta_key = '_product_attributes'
      AND meta_value IS NOT NULL AND meta_value != ''
  `);

  const result = new Map<number, Record<string, any>>();
  for (const r of rows) {
    const parsed = phpUnserialize(r.meta_value);
    if (parsed && typeof parsed === 'object') {
      result.set(r.post_id, parsed as Record<string, any>);
    }
  }

  return result;
}

/**
 * Load category slugs for a set of product IDs.
 * Returns Map<productId, categorySlugs[]>.
 */
export async function loadProductCategories(
  db: Connection,
  productIds: number[]
): Promise<Map<number, string[]>> {
  if (productIds.length === 0) return new Map();

  const inClause = sqlInList(productIds);
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT tr.object_id as productId, t.slug
    FROM wp_term_relationships tr
    JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
    JOIN wp_terms t ON t.term_id = tt.term_id
    WHERE tr.object_id IN ${inClause}
      AND tt.taxonomy = 'product_cat'
  `);

  const result = new Map<number, string[]>();
  for (const r of rows) {
    if (!result.has(r.productId)) result.set(r.productId, []);
    result.get(r.productId)!.push(r.slug);
  }

  return result;
}

/**
 * Check if a slug already exists in wp_posts.
 */
export async function slugExists(db: Connection, slug: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM wp_posts WHERE post_name = ? LIMIT 1`,
    [slug]
  );
  return rows.length > 0;
}

/**
 * Check if a term exists in a given taxonomy.
 */
export async function termExists(
  db: Connection,
  taxonomy: string,
  slug: string
): Promise<{ termId: number; termTaxonomyId: number } | null> {
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT t.term_id as termId, tt.term_taxonomy_id as termTaxonomyId
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
    WHERE tt.taxonomy = ? AND t.slug = ?
    LIMIT 1
  `, [taxonomy, slug]);

  if (rows.length === 0) return null;
  return { termId: rows[0].termId, termTaxonomyId: rows[0].termTaxonomyId };
}

/**
 * Get all existing term slugs for a taxonomy.
 */
export async function getExistingTermSlugs(
  db: Connection,
  taxonomy: string
): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>(`
    SELECT t.slug
    FROM wp_terms t
    JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
    WHERE tt.taxonomy = ?
  `, [taxonomy]);

  return new Set(rows.map(r => r.slug));
}
