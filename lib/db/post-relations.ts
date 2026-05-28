/**
 * Read layer for the post ⇄ product relationships managed by the
 * `maleq-post-product-relations` mu-plugin.
 *
 * Relations are stored as ordered CSV in two protected post-meta keys:
 *   _maleq_related_products      → CSV of product post IDs (order = ranking)
 *   _maleq_related_product_cats  → CSV of product_cat term IDs
 *
 * CSV (rather than PHP-serialized arrays) keeps the read path a plain SQL
 * lookup and lets the reverse direction use MySQL's FIND_IN_SET().
 *
 * Forward  (post → products/categories): loadPostRelations()
 * Reverse  (product → guides):           loadRelatedPostsForProduct()
 */
import { getPoolAsync } from './pool';
import { loadBlogPostsByIds } from './blog-loader';
import { getIndexEntryById } from '@/lib/products/product-index';
import { indexEntryToUnifiedProduct } from '@/lib/products/index-to-unified';
import type { UnifiedProduct } from '@/lib/products/combined-service';
import type { RowDataPacket } from 'mysql2';
import type { Post } from '@/lib/types/wordpress';

const PRODUCTS_META = '_maleq_related_products';
const CATS_META = '_maleq_related_product_cats';

export interface PostRelations {
  /** Product IDs in editor-defined display order. */
  productIds: number[];
  /** product_cat term IDs. */
  categoryTermIds: number[];
}

/** Parse a stored CSV meta value into a clean, order-preserving int list. */
function parseCsvIds(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Forward lookup: the products & product categories an editor attached to a post.
 */
export async function loadPostRelations(postId: number): Promise<PostRelations> {
  if (!postId) return { productIds: [], categoryTermIds: [] };

  const pool = await getPoolAsync();
  const [rows] = await pool.query<(RowDataPacket & { meta_key: string; meta_value: string | null })[]>(
    `SELECT meta_key, meta_value
       FROM wp_postmeta
      WHERE post_id = ? AND meta_key IN (?, ?)`,
    [postId, PRODUCTS_META, CATS_META],
  );

  let productIds: number[] = [];
  let categoryTermIds: number[] = [];
  for (const row of rows) {
    if (row.meta_key === PRODUCTS_META) productIds = parseCsvIds(row.meta_value);
    else if (row.meta_key === CATS_META) categoryTermIds = parseCsvIds(row.meta_value);
  }

  return { productIds, categoryTermIds };
}

/**
 * Reverse lookup: published post IDs that directly reference a given product
 * in their _maleq_related_products list. Newest first.
 */
export async function loadPostIdsReferencingProduct(
  productId: number,
  limit = 12,
): Promise<number[]> {
  if (!productId) return [];

  const pool = await getPoolAsync();
  const [rows] = await pool.query<(RowDataPacket & { ID: number })[]>(
    `SELECT p.ID
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key = ?
        AND FIND_IN_SET(?, pm.meta_value)
        AND p.post_type = 'post'
        AND p.post_status = 'publish'
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [PRODUCTS_META, productId, limit],
  );

  return rows.map(r => r.ID);
}

/**
 * Reverse lookup by category: published post IDs whose related-category list
 * overlaps any of the given product_cat term IDs. Used as a fallback when a
 * product has no direct guide references. Newest first.
 */
export async function loadPostIdsForProductCategoryTerms(
  termIds: number[],
  limit = 12,
): Promise<number[]> {
  if (!termIds.length) return [];

  const pool = await getPoolAsync();
  // One FIND_IN_SET per term, OR'd together (term lists are small).
  const orClause = termIds.map(() => 'FIND_IN_SET(?, pm.meta_value)').join(' OR ');
  const [rows] = await pool.query<(RowDataPacket & { ID: number })[]>(
    `SELECT p.ID
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key = ?
        AND (${orClause})
        AND p.post_type = 'post'
        AND p.post_status = 'publish'
      ORDER BY p.post_date DESC
      LIMIT ?`,
    [CATS_META, ...termIds, limit],
  );

  return rows.map(r => r.ID);
}

/**
 * "Related guides" for a product page: posts that directly reference the
 * product, topped up with posts related to the product's categories.
 * Returns fully-mapped Post objects, de-duplicated, in priority order.
 */
export async function loadRelatedPostsForProduct(opts: {
  productId: number;
  categoryTermIds?: number[];
  limit?: number;
}): Promise<Post[]> {
  const { productId, categoryTermIds = [], limit = 6 } = opts;

  const directIds = await loadPostIdsReferencingProduct(productId, limit);

  // Top up with category-related posts only if we need more.
  let ids = directIds;
  if (ids.length < limit && categoryTermIds.length > 0) {
    const catIds = await loadPostIdsForProductCategoryTerms(categoryTermIds, limit * 2);
    const seen = new Set(ids);
    for (const id of catIds) {
      if (!seen.has(id)) {
        ids.push(id);
        seen.add(id);
      }
      if (ids.length >= limit) break;
    }
  }

  if (ids.length === 0) return [];
  return loadBlogPostsByIds(ids.slice(0, limit));
}

// ─── Forward resolution for the post page (products + category links) ───

export interface RelatedProductCategory {
  termId: number;
  name: string;
  slug: string;
}

export interface PostRecommendations {
  /** Editor-curated products, resolved & ordered, ready for ProductCarousel. */
  products: UnifiedProduct[];
  /** Editor-curated product categories, for "browse more" links. */
  categories: RelatedProductCategory[];
}

/** Resolve product_cat term IDs → {name, slug}, preserving order. */
export async function loadProductCategoryTerms(
  termIds: number[],
): Promise<RelatedProductCategory[]> {
  if (!termIds.length) return [];

  const pool = await getPoolAsync();
  const placeholders = termIds.map(() => '?').join(',');
  const [rows] = await pool.query<(RowDataPacket & { term_id: number; name: string; slug: string })[]>(
    `SELECT t.term_id, t.name, t.slug
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
      WHERE tt.taxonomy = 'product_cat' AND t.term_id IN (${placeholders})`,
    termIds,
  );

  const byId = new Map<number, RelatedProductCategory>(
    rows.map(r => [r.term_id, { termId: r.term_id, name: r.name, slug: r.slug }]),
  );
  return termIds
    .map(id => byId.get(id))
    .filter((c): c is RelatedProductCategory => c !== undefined);
}

/** Resolve product IDs → UnifiedProduct via the in-memory index, order preserved. */
async function resolveProducts(ids: number[]): Promise<UnifiedProduct[]> {
  if (!ids.length) return [];
  const entries = await Promise.all(ids.map(id => getIndexEntryById(id)));
  const out: UnifiedProduct[] = [];
  for (const entry of entries) {
    if (entry) out.push(indexEntryToUnifiedProduct(entry));
  }
  return out;
}

/**
 * Everything a post page needs to render its "Recommended Products" block:
 * the curated products (resolved from the index) and category links.
 */
export async function loadPostRecommendations(postId: number): Promise<PostRecommendations> {
  const { productIds, categoryTermIds } = await loadPostRelations(postId);

  const [products, categories] = await Promise.all([
    resolveProducts(productIds),
    loadProductCategoryTerms(categoryTermIds),
  ]);

  return { products, categories };
}
