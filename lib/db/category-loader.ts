/**
 * Loads hierarchical product categories from MySQL.
 *
 * Single query fetching all product categories with parent relationships,
 * then builds the tree in memory. Cached in-process with 5-minute TTL.
 */
import { getPoolAsync } from './pool';
import type { RowDataPacket } from 'mysql2';
import type { HierarchicalCategory } from '@/lib/products/combined-service';
import type { ProductCategory } from '@/lib/types/woocommerce';
import { decodeHtmlEntities } from '@/lib/utils/text-utils';

interface DbCategory extends RowDataPacket {
  term_id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
  thumb_url: string | null;
}

let cachedCategories: HierarchicalCategory[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function encodeId(prefix: string, id: number): string {
  return Buffer.from(`${prefix}:${id}`).toString('base64');
}

export async function loadHierarchicalCategories(): Promise<HierarchicalCategory[]> {
  if (cachedCategories && Date.now() - cacheTime < CACHE_TTL) {
    return cachedCategories;
  }

  const pool = await getPoolAsync();

  const [rows] = await pool.query<DbCategory[]>(`
    SELECT
      t.term_id,
      t.name,
      t.slug,
      tt.parent,
      tt.count,
      att.guid AS thumb_url
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    LEFT JOIN wp_termmeta tm ON t.term_id = tm.term_id AND tm.meta_key = 'thumbnail_id'
    LEFT JOIN wp_posts att ON att.ID = CAST(tm.meta_value AS UNSIGNED)
    WHERE tt.taxonomy = 'product_cat'
    ORDER BY t.name
  `);

  // Build lookup map
  const catMap = new Map<number, DbCategory & { childIds: number[] }>();
  for (const row of rows) {
    catMap.set(row.term_id, { ...row, childIds: [] });
  }

  // Link parent → children
  for (const row of rows) {
    if (row.parent > 0) {
      const parent = catMap.get(row.parent);
      if (parent) {
        parent.childIds.push(row.term_id);
      }
    }
  }

  // Recursively build tree
  function buildTree(termId: number): HierarchicalCategory | null {
    const cat = catMap.get(termId);
    if (!cat || cat.count <= 0) return null;
    return {
      id: encodeId('term', cat.term_id),
      name: decodeHtmlEntities(cat.name),
      slug: cat.slug,
      count: cat.count,
      image: cat.thumb_url || null,
      children: cat.childIds
        .map(buildTree)
        .filter((c): c is HierarchicalCategory => c !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  const result = rows
    .filter(r => r.parent === 0)
    .map(r => buildTree(r.term_id))
    .filter((c): c is HierarchicalCategory => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedCategories = result;
  cacheTime = Date.now();
  return result;
}

export function invalidateCategoryCache(): void {
  cachedCategories = null;
  cacheTime = 0;
  cachedFlatCategories = null;
  flatCacheTime = 0;
}

// ─── Flat Category List ───

let cachedFlatCategories: ProductCategory[] | null = null;
let flatCacheTime = 0;

interface DbFlatCategory extends RowDataPacket {
  term_id: number;
  name: string;
  slug: string;
  description: string | null;
  count: number;
  thumb_url: string | null;
}

export async function loadFlatCategories(): Promise<ProductCategory[]> {
  if (cachedFlatCategories && Date.now() - flatCacheTime < CACHE_TTL) {
    return cachedFlatCategories;
  }

  const pool = await getPoolAsync();

  const [rows] = await pool.query<DbFlatCategory[]>(`
    SELECT
      t.term_id,
      t.name,
      t.slug,
      tt.description,
      tt.count,
      att.guid AS thumb_url
    FROM wp_term_taxonomy tt
    JOIN wp_terms t ON tt.term_id = t.term_id
    LEFT JOIN wp_termmeta tm ON t.term_id = tm.term_id AND tm.meta_key = 'thumbnail_id'
    LEFT JOIN wp_posts att ON att.ID = CAST(tm.meta_value AS UNSIGNED)
    WHERE tt.taxonomy = 'product_cat' AND tt.count > 0
    ORDER BY t.name
  `);

  const result: ProductCategory[] = rows.map(row => ({
    id: encodeId('term', row.term_id),
    name: decodeHtmlEntities(row.name),
    slug: row.slug,
    description: row.description || undefined,
    count: row.count,
    image: row.thumb_url ? { sourceUrl: row.thumb_url } : undefined,
  }));

  cachedFlatCategories = result;
  flatCacheTime = Date.now();
  return result;
}
