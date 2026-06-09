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
import type { ProductIndexEntry } from '@/lib/db/index-loader';
import { allowedDims, type AttrDim } from '@/scripts/lib/attribute-rules';
import type { RowDataPacket } from 'mysql2';
import type { Post } from '@/lib/types/wordpress';

const PRODUCTS_META = '_maleq_related_products';
const CATS_META = '_maleq_related_product_cats';

// New roundup ("Best of") meta keys — see docs/BUYERS_GUIDE_SYSTEM.md.
const TYPE_META = '_maleq_guide_type';        // string, 'roundup' = programmatic layout
const ENTRIES_META = '_maleq_guide_entries';  // JSON, editorial overlay keyed by product ID
const FAQ_META = '_maleq_guide_faq';          // JSON, [{q,a}] → FAQPage schema
const GMETA_META = '_maleq_guide_meta';       // JSON, { methodology, lastReviewed, columns? }

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

// ─── Roundup ("Best [X]") guide resolution ──────────────────────────────────
//
// A roundup is a normal post (post_type='post') flagged with _maleq_guide_type=
// 'roundup'. The ranked product list lives in _maleq_related_products (CSV, order
// = ranking); a thin editorial overlay lives in _maleq_guide_entries (JSON, keyed
// by product ID). Everything else — price, rating, specs, image — is resolved
// LIVE from the product index so the guide never goes stale. See
// docs/BUYERS_GUIDE_SYSTEM.md.

/** Editorial fields an editor (or the generator) attaches to one ranked product. */
export interface GuideEntryEditorial {
  award?: string;        // badge, e.g. "Best Overall" / "Best Budget"
  bestFor?: string;      // e.g. "Beginners"
  verdict?: string;      // 1–2 sentence editorial take
  pros?: string[];
  cons?: string[];
  editorRating?: number; // overrides/augments the live review average
}

/** One spec column in the comparison table, derived per category. */
export interface SpecColumn {
  dim: AttrDim;   // 'length' | 'volume' | 'color' | 'material'
  label: string;  // 'Length', 'Volume', …
}

/** A fully-resolved ranked entry: live product data + editorial overlay. */
export interface GuideEntry {
  rank: number;                 // 1-based ranking (CSV order)
  product: UnifiedProduct;      // for card display (reuses ProductCard styling)
  index: ProductIndexEntry;     // raw numerics for schema (price/rating) + specs
  award?: string;
  bestFor?: string;
  verdict?: string;
  pros: string[];
  cons: string[];
  rating: number;               // editorRating ?? index.averageRating
  reviewCount: number;
  /** Display spec values keyed by dimension, aligned to the guide's columns. */
  specs: Partial<Record<AttrDim, string>>;
}

export interface ResolvedGuide {
  /** 'roundup' when this post uses the programmatic layout, else null. */
  type: 'roundup' | null;
  entries: GuideEntry[];
  faq: { q: string; a: string }[];
  columns: SpecColumn[];
  meta: { methodology?: string; lastReviewed?: string };
}

const EMPTY_GUIDE: ResolvedGuide = {
  type: null,
  entries: [],
  faq: [],
  columns: [],
  meta: {},
};

/** Parse a JSON meta value, returning `fallback` on any malformed/empty input. */
function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** "hot-pink" → "Hot Pink", "8-in" → "8 In". Index stores canonical slugs only. */
function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Spec dimensions the comparison table can show, in priority order (= column
 * order when several apply). Two sources:
 *   - 'index': carried by the in-memory ProductIndexEntry (length/volume/color/
 *      material) — cheap, already loaded.
 *   - 'db': resolved per-request via a single term query (flavor/apparel-size/
 *      count) because the index doesn't carry them. Keeps lube/condom/apparel
 *      roundups from missing their most relevant column.
 */
type SpecSource =
  | { from: 'index'; values: (e: ProductIndexEntry) => string[] }
  | { from: 'db'; taxonomy: string };

const SPEC_DIMS: { dim: AttrDim; label: string; source: SpecSource }[] = [
  { dim: 'length', label: 'Length', source: { from: 'index', values: (e) => e.lengthSlugs.map(humanizeSlug) } },
  { dim: 'volume', label: 'Volume', source: { from: 'index', values: (e) => e.volumeSlugs.map(humanizeSlug) } },
  { dim: 'flavor', label: 'Flavor', source: { from: 'db', taxonomy: 'pa_flavor' } },
  { dim: 'color', label: 'Color', source: { from: 'index', values: (e) => e.colorSlugs.map(humanizeSlug) } },
  { dim: 'material', label: 'Material', source: { from: 'index', values: (e) => (e.materialName ? [e.materialName] : []) } },
  { dim: 'apparel', label: 'Size', source: { from: 'db', taxonomy: 'pa_size' } },
  { dim: 'count', label: 'Count', source: { from: 'db', taxonomy: 'pa_pack' } },
];

/** DB-sourced spec taxonomies → dimension (for the per-request term lookup). */
const DB_SPEC_TAXONOMIES: Record<string, AttrDim> = {
  pa_flavor: 'flavor',
  pa_size: 'apparel',
  pa_pack: 'count',
};

/** Per-product DB-sourced spec term names, keyed by product ID then dimension. */
type DbSpecMap = Map<number, Partial<Record<AttrDim, string[]>>>;

const MAX_SPEC_COLUMNS = 3;

/** Comma-join up to two display values for a spec cell ("Hot Pink, Black"). */
function specCell(values: string[]): string | null {
  if (!values.length) return null;
  return values.slice(0, 2).join(', ');
}

/** All display values for one dimension on one product, from whichever source. */
function specValuesFor(dim: AttrDim, index: ProductIndexEntry, dbTerms: Partial<Record<AttrDim, string[]>> | undefined): string[] {
  const spec = SPEC_DIMS.find((s) => s.dim === dim);
  if (!spec) return [];
  return spec.source.from === 'index' ? spec.source.values(index) : (dbTerms?.[dim] ?? []);
}

/**
 * Load the DB-sourced spec terms (flavor / apparel-size / pack count) for a set
 * of products in one query. Term NAMES are used directly (already human-readable).
 */
async function loadDbSpecTerms(ids: number[]): Promise<DbSpecMap> {
  const out: DbSpecMap = new Map();
  if (!ids.length) return out;

  const pool = await getPoolAsync();
  const idPlaceholders = ids.map(() => '?').join(',');
  const taxes = Object.keys(DB_SPEC_TAXONOMIES);
  const taxPlaceholders = taxes.map(() => '?').join(',');
  const [rows] = await pool.query<(RowDataPacket & { pid: number; taxonomy: string; name: string })[]>(
    `SELECT tr.object_id AS pid, tt.taxonomy AS taxonomy, t.name AS name
       FROM wp_term_relationships tr
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
       JOIN wp_terms t ON t.term_id = tt.term_id
      WHERE tr.object_id IN (${idPlaceholders})
        AND tt.taxonomy IN (${taxPlaceholders})`,
    [...ids, ...taxes],
  );

  for (const r of rows) {
    const dim = DB_SPEC_TAXONOMIES[r.taxonomy];
    if (!dim) continue;
    const m = out.get(r.pid) ?? {};
    const arr = m[dim] ?? [];
    if (!arr.includes(r.name)) arr.push(r.name);
    m[dim] = arr;
    out.set(r.pid, m);
  }
  return out;
}

/**
 * Decide which spec columns the comparison table shows for this guide:
 * dimensions allowed for the products' category family (reusing the canonical
 * CATEGORY_RULES via allowedDims) AND present on at least one product, in
 * priority order, capped at MAX_SPEC_COLUMNS.
 */
function deriveColumns(resolved: { id: number; index: ProductIndexEntry }[], dbTerms: DbSpecMap): SpecColumn[] {
  if (!resolved.length) return [];
  const catSlugs = [...new Set(resolved.flatMap((r) => r.index.categorySlugs))];
  const allowed = allowedDims(catSlugs);
  const cols: SpecColumn[] = [];
  for (const spec of SPEC_DIMS) {
    if (!allowed.has(spec.dim)) continue;
    const present = resolved.some((r) => specValuesFor(spec.dim, r.index, dbTerms.get(r.id)).length > 0);
    if (!present) continue;
    cols.push({ dim: spec.dim, label: spec.label });
    if (cols.length >= MAX_SPEC_COLUMNS) break;
  }
  return cols;
}

/** Validate the FAQ JSON into a clean [{q,a}] list, dropping malformed rows. */
function parseFaq(value: string | null | undefined): { q: string; a: string }[] {
  const raw = safeJson<unknown>(value, []);
  if (!Array.isArray(raw)) return [];
  const out: { q: string; a: string }[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const q = (item as Record<string, unknown>).q;
      const a = (item as Record<string, unknown>).a;
      if (typeof q === 'string' && typeof a === 'string' && q.trim() && a.trim()) {
        out.push({ q: q.trim(), a: a.trim() });
      }
    }
  }
  return out;
}

/**
 * Load and fully resolve a roundup guide for a post: ranking (CSV order) merged
 * with the editorial overlay (JSON), products resolved live from the index,
 * spec columns derived per category, FAQ + guide meta parsed.
 *
 * Returns EMPTY_GUIDE (type:null) when the post isn't a roundup or has no
 * resolvable products, so the page can fall back to its normal article layout.
 */
export async function loadGuide(postId: number): Promise<ResolvedGuide> {
  if (!postId) return EMPTY_GUIDE;

  const pool = await getPoolAsync();
  const [rows] = await pool.query<(RowDataPacket & { meta_key: string; meta_value: string | null })[]>(
    `SELECT meta_key, meta_value
       FROM wp_postmeta
      WHERE post_id = ? AND meta_key IN (?, ?, ?, ?, ?)`,
    [postId, PRODUCTS_META, TYPE_META, ENTRIES_META, FAQ_META, GMETA_META],
  );

  const byKey = new Map<string, string | null>();
  for (const row of rows) byKey.set(row.meta_key, row.meta_value);

  // Not a roundup → let the caller render the normal article layout.
  if ((byKey.get(TYPE_META) || '').trim() !== 'roundup') return EMPTY_GUIDE;

  const productIds = parseCsvIds(byKey.get(PRODUCTS_META));
  if (productIds.length === 0) return EMPTY_GUIDE;

  const overlay = safeJson<Record<string, GuideEntryEditorial>>(byKey.get(ENTRIES_META), {});
  const faq = parseFaq(byKey.get(FAQ_META));
  const guideMeta = safeJson<{ methodology?: string; lastReviewed?: string }>(byKey.get(GMETA_META), {});

  // Resolve products LIVE from the index, preserving ranking order.
  const indexEntries = await Promise.all(productIds.map((id) => getIndexEntryById(id)));

  const resolved: { id: number; index: ProductIndexEntry }[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const entry = indexEntries[i];
    if (entry) resolved.push({ id: productIds[i], index: entry });
  }
  if (resolved.length === 0) return EMPTY_GUIDE;

  // DB-sourced spec terms (flavor / apparel-size / count) for these products.
  const dbTerms = await loadDbSpecTerms(resolved.map((r) => r.id));
  const columns = deriveColumns(resolved, dbTerms);

  const entries: GuideEntry[] = resolved.map((r, i) => {
    const ed = overlay[String(r.id)] ?? {};
    const rating =
      typeof ed.editorRating === 'number' && ed.editorRating > 0
        ? ed.editorRating
        : r.index.averageRating;

    const productDbTerms = dbTerms.get(r.id);
    const specs: Partial<Record<AttrDim, string>> = {};
    for (const col of columns) {
      const cell = specCell(specValuesFor(col.dim, r.index, productDbTerms));
      if (cell) specs[col.dim] = cell;
    }

    return {
      rank: i + 1,
      product: indexEntryToUnifiedProduct(r.index),
      index: r.index,
      award: ed.award?.trim() || undefined,
      bestFor: ed.bestFor?.trim() || undefined,
      verdict: ed.verdict?.trim() || undefined,
      pros: Array.isArray(ed.pros) ? ed.pros.filter((p) => typeof p === 'string' && p.trim()) : [],
      cons: Array.isArray(ed.cons) ? ed.cons.filter((c) => typeof c === 'string' && c.trim()) : [],
      rating,
      reviewCount: r.index.reviewCount,
      specs,
    };
  });

  return {
    type: 'roundup',
    entries,
    faq,
    columns,
    meta: {
      methodology: guideMeta.methodology?.trim() || undefined,
      lastReviewed: guideMeta.lastReviewed?.trim() || undefined,
    },
  };
}
