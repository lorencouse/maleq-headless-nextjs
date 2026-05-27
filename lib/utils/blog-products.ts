/**
 * Utilities for extracting and fetching products embedded in blog content.
 *
 * Resolution priority:
 *   1. In-memory product index (O(1), no DB hit) — covers ~all simple/variable products
 *   2. Single SQL query for the unresolved IDs (typically variations or
 *      newly-created products not yet in the index)
 *
 * Previous implementation issued one GraphQL request per ID (plus a fallback
 * variation query per miss), which fanned out into many slow WP queries on
 * post pages that referenced multiple products.
 */

import { getPoolAsync } from '@/lib/db/pool';
import { getIndexEntryById } from '@/lib/products/product-index';
import { getProductionImageUrl } from './image';
import type { RowDataPacket } from 'mysql2';

export interface BlogProduct {
  id: number;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  regularPrice: number;
  salePrice: number | null;
  onSale: boolean;
  image: { url: string; altText: string } | null;
  inStock: boolean;
}

interface RawProductOrVariationRow extends RowDataPacket {
  ID: number;
  post_title: string;
  post_type: string;
  parent_id: number | null;
  parent_title: string | null;
  parent_slug: string | null;
  sku: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string | null;
  thumbnail_id: string | null;
  thumb_url: string | null;
  thumb_alt: string | null;
}

/**
 * Extract product IDs from WooCommerce shortcode HTML in blog content
 * Looks for data-product_id attributes in the raw content
 */
export function extractProductIdsFromContent(content: string): number[] {
  if (!content) return [];

  const ids: number[] = [];

  // Match data-product_id="123" patterns from WooCommerce shortcode output
  const regex = /data-product_id="(\d+)"/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    if (!isNaN(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Parse WooCommerce price string to number
 */
function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;
  const cleaned = price.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Fetch the unresolved IDs (after the index miss) from MySQL in one round.
 * Handles both product and product_variation post types.
 */
async function fetchUnresolvedFromDb(ids: number[]): Promise<Map<number, BlogProduct>> {
  const map = new Map<number, BlogProduct>();
  if (ids.length === 0) return map;

  const pool = await getPoolAsync();
  const placeholders = ids.map(() => '?').join(',');

  // Single query: product or variation row + scalar postmeta lookups via subqueries.
  // Following the same pattern as lib/db/index-loader.ts — subqueries beat
  // LEFT JOIN chains on wp_postmeta.
  const [rows] = await pool.query<RawProductOrVariationRow[]>(
    `SELECT
       p.ID, p.post_title, p.post_type,
       parent.ID AS parent_id,
       parent.post_title AS parent_title,
       parent.post_name AS parent_slug,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sku' LIMIT 1) AS sku,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_price' LIMIT 1) AS price,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_regular_price' LIMIT 1) AS regular_price,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sale_price' LIMIT 1) AS sale_price,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_stock_status' LIMIT 1) AS stock_status,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1) AS thumbnail_id,
       att.guid AS thumb_url,
       att.post_excerpt AS thumb_alt
     FROM wp_posts p
     LEFT JOIN wp_posts parent ON parent.ID = p.post_parent AND parent.post_type = 'product'
     LEFT JOIN wp_posts att ON att.ID = (
       SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1
     )
     WHERE p.ID IN (${placeholders})
       AND p.post_type IN ('product', 'product_variation')
       AND p.post_status = 'publish'`,
    ids,
  );

  for (const row of rows) {
    const isVariation = row.post_type === 'product_variation';
    const price = parsePrice(row.sale_price || row.price);
    const regularPrice = parsePrice(row.regular_price) || price;
    const salePrice = row.sale_price ? parsePrice(row.sale_price) : null;
    const slug = isVariation ? (row.parent_slug || '') : '';
    const name = row.post_title || row.parent_title || '';

    map.set(row.ID, {
      id: row.ID,
      name,
      slug,
      sku: row.sku || null,
      price,
      regularPrice,
      salePrice,
      onSale: salePrice !== null && salePrice < regularPrice,
      image: row.thumb_url
        ? {
            url: getProductionImageUrl(row.thumb_url),
            altText: row.thumb_alt || name,
          }
        : null,
      inStock: (row.stock_status || '').toLowerCase() === 'instock',
    });
  }

  return map;
}

/**
 * Fetch products by their database IDs. Hits the in-memory product index
 * first for O(1) lookups, then falls back to a single SQL query for any
 * misses (typically product variations).
 *
 * Returns a map of productId -> BlogProduct for easy lookup.
 */
export async function fetchProductsByIds(ids: number[]): Promise<Map<number, BlogProduct>> {
  const productMap = new Map<number, BlogProduct>();
  if (ids.length === 0) return productMap;

  const unresolved: number[] = [];

  // First pass: in-memory index. Covers any top-level product currently
  // tracked by the runtime — no DB round-trip.
  await Promise.all(
    ids.map(async (id) => {
      const entry = await getIndexEntryById(id);
      if (!entry) {
        unresolved.push(id);
        return;
      }
      productMap.set(id, {
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        sku: null,
        price: entry.price ?? 0,
        regularPrice: entry.regularPrice ?? entry.price ?? 0,
        salePrice: entry.salePrice,
        onSale: entry.onSale,
        image: entry.imageUrl
          ? {
              url: getProductionImageUrl(entry.imageUrl),
              altText: entry.imageAlt || entry.name,
            }
          : null,
        inStock: entry.stockStatus === 'IN_STOCK',
      });
    }),
  );

  // Second pass: one SQL round-trip for everything missed by the index.
  if (unresolved.length > 0) {
    try {
      const dbMap = await fetchUnresolvedFromDb(unresolved);
      for (const [id, product] of dbMap) {
        productMap.set(id, product);
      }
      for (const id of unresolved) {
        if (!productMap.has(id)) {
          console.warn(`Product or variation not found for ID ${id}`);
        }
      }
    } catch (err) {
      console.error('fetchProductsByIds: SQL fallback failed', err);
    }
  }

  return productMap;
}

/**
 * Convert product map to a plain object for serialization
 */
export function productMapToObject(map: Map<number, BlogProduct>): Record<string, BlogProduct> {
  const obj: Record<string, BlogProduct> = {};
  map.forEach((value, key) => {
    obj[key.toString()] = value;
  });
  return obj;
}
