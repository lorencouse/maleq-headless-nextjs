/**
 * DB Mutations — all write operations for the variant manager pipeline.
 *
 * Every operation runs in its own transaction for atomicity.
 * Callers manage the transaction lifecycle.
 */

import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { phpSerialize } from '../php-unserialize';
import { toSlug } from './utils';
import { slugExists, termExists } from './db-queries';

/**
 * Create a new parent product by cloning an existing one.
 * Copies: post data, all postmeta, taxonomy relationships.
 */
export async function createParentProduct(
  db: Connection,
  fromParentId: number,
  newTitle: string,
  newSlug: string
): Promise<number> {
  // Ensure slug is unique
  let slug = newSlug;
  let counter = 2;
  while (await slugExists(db, slug)) {
    slug = `${newSlug}-${counter}`;
    counter++;
  }

  // Clone the post (include to_ping, pinged, post_content_filtered which have no defaults)
  const [result] = await db.query<ResultSetHeader>(`
    INSERT INTO wp_posts (
      post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
      post_status, comment_status, ping_status, post_name, post_parent,
      post_type, post_mime_type, comment_count,
      post_modified, post_modified_gmt,
      to_ping, pinged, post_content_filtered
    )
    SELECT
      post_author, NOW(), UTC_TIMESTAMP(), post_content, ?, post_excerpt,
      post_status, comment_status, ping_status, ?, post_parent,
      post_type, post_mime_type, comment_count,
      NOW(), UTC_TIMESTAMP(),
      '', '', ''
    FROM wp_posts WHERE ID = ?
  `, [newTitle, slug, fromParentId]);

  const newId = result.insertId;

  // Clone postmeta (skip unique fields that need recalculation)
  const skipMeta = new Set(['_edit_lock', '_edit_last', '_wp_old_slug']);
  await db.query(`
    INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
    SELECT ?, meta_key, meta_value
    FROM wp_postmeta
    WHERE post_id = ? AND meta_key NOT IN (${[...skipMeta].map(() => '?').join(',')})
  `, [newId, fromParentId, ...skipMeta]);

  // Clone taxonomy relationships (categories, tags, product_type)
  await db.query(`
    INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
    SELECT ?, term_taxonomy_id, term_order
    FROM wp_term_relationships WHERE object_id = ?
  `, [newId, fromParentId]);

  // Update term counts
  await db.query(`
    UPDATE wp_term_taxonomy tt
    SET count = count + 1
    WHERE tt.term_taxonomy_id IN (
      SELECT term_taxonomy_id FROM wp_term_relationships WHERE object_id = ?
    )
  `, [newId]);

  return newId;
}

/**
 * Move variations to a new parent product.
 */
export async function moveVariationsToParent(
  db: Connection,
  variationIds: number[],
  newParentId: number
): Promise<void> {
  if (variationIds.length === 0) return;

  await db.query(`
    UPDATE wp_posts
    SET post_parent = ?
    WHERE ID IN (${variationIds.join(',')})
      AND post_type = 'product_variation'
  `, [newParentId]);
}

/**
 * Delete variations (posts + their meta).
 */
export async function deleteVariations(
  db: Connection,
  variationIds: number[]
): Promise<void> {
  if (variationIds.length === 0) return;

  const inList = variationIds.join(',');

  // Delete meta first
  await db.query(`DELETE FROM wp_postmeta WHERE post_id IN (${inList})`);
  // Delete term relationships
  await db.query(`DELETE FROM wp_term_relationships WHERE object_id IN (${inList})`);
  // Delete posts
  await db.query(`DELETE FROM wp_posts WHERE ID IN (${inList}) AND post_type = 'product_variation'`);
}

/**
 * Set a parent product to draft status.
 */
export async function setParentDraft(
  db: Connection,
  parentId: number
): Promise<void> {
  await db.query(`
    UPDATE wp_posts SET post_status = 'draft' WHERE ID = ? AND post_type = 'product'
  `, [parentId]);
}

/**
 * Update a variation's attribute: change meta key and/or value.
 */
export async function updateVariationAttribute(
  db: Connection,
  variationId: number,
  oldKey: string,
  newKey: string,
  newValue: string
): Promise<void> {
  if (oldKey === newKey) {
    // Same key, just update value
    await db.query(`
      UPDATE wp_postmeta
      SET meta_value = ?
      WHERE post_id = ? AND meta_key = ?
    `, [newValue, variationId, oldKey]);
  } else {
    // Delete old, insert new
    await db.query(`
      DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?
    `, [variationId, oldKey]);

    await db.query(`
      INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
      VALUES (?, ?, ?)
    `, [variationId, newKey, newValue]);
  }
}

/**
 * Update the parent product's _product_attributes meta.
 * Takes a JS object and serializes it to PHP format.
 */
export async function updateParentProductAttributes(
  db: Connection,
  parentId: number,
  attrs: Record<string, any>
): Promise<void> {
  const serialized = phpSerialize(attrs);

  // Check if meta exists
  const [existing] = await db.query<RowDataPacket[]>(`
    SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_attributes' LIMIT 1
  `, [parentId]);

  if (existing.length > 0) {
    await db.query(`
      UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'
    `, [serialized, parentId]);
  } else {
    await db.query(`
      INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)
    `, [parentId, serialized]);
  }
}

/**
 * Create an attribute term in wp_terms + wp_term_taxonomy if it doesn't exist.
 * Returns the term_taxonomy_id.
 */
export async function ensureAttributeTerm(
  db: Connection,
  taxonomy: string,
  name: string,
  slug: string
): Promise<number> {
  // Check if already exists
  const existing = await termExists(db, taxonomy, slug);
  if (existing) return existing.termTaxonomyId;

  // Create term
  const [termResult] = await db.query<ResultSetHeader>(`
    INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)
  `, [name, slug]);
  const termId = termResult.insertId;

  // Create term_taxonomy
  const [ttResult] = await db.query<ResultSetHeader>(`
    INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
    VALUES (?, ?, '', 0, 0)
  `, [termId, taxonomy]);

  return ttResult.insertId;
}

/**
 * Link a term to a product via wp_term_relationships.
 */
export async function linkTermToProduct(
  db: Connection,
  productId: number,
  termTaxonomyId: number
): Promise<void> {
  // Check if already linked
  const [existing] = await db.query<RowDataPacket[]>(`
    SELECT 1 FROM wp_term_relationships
    WHERE object_id = ? AND term_taxonomy_id = ?
    LIMIT 1
  `, [productId, termTaxonomyId]);

  if (existing.length > 0) return;

  await db.query(`
    INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
    VALUES (?, ?, 0)
  `, [productId, termTaxonomyId]);

  // Update count
  await db.query(`
    UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?
  `, [termTaxonomyId]);
}

/**
 * Update the wp_wc_product_meta_lookup table for a product.
 */
export async function updateMetaLookup(
  db: Connection,
  parentId: number
): Promise<void> {
  // Recalculate from child variations
  const [priceRows] = await db.query<RowDataPacket[]>(`
    SELECT MIN(CAST(pm.meta_value AS DECIMAL(10,2))) as minPrice,
           MAX(CAST(pm.meta_value AS DECIMAL(10,2))) as maxPrice
    FROM wp_postmeta pm
    JOIN wp_posts v ON v.ID = pm.post_id
    WHERE v.post_parent = ? AND v.post_type = 'product_variation'
      AND pm.meta_key = '_price'
      AND pm.meta_value IS NOT NULL AND pm.meta_value != ''
  `, [parentId]);

  const minPrice = priceRows[0]?.minPrice || 0;
  const maxPrice = priceRows[0]?.maxPrice || 0;

  // Get SKU
  const [skuRows] = await db.query<RowDataPacket[]>(`
    SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_sku' LIMIT 1
  `, [parentId]);
  const sku = skuRows[0]?.meta_value || '';

  // Update or insert
  const [existing] = await db.query<RowDataPacket[]>(`
    SELECT 1 FROM wp_wc_product_meta_lookup WHERE product_id = ? LIMIT 1
  `, [parentId]);

  if (existing.length > 0) {
    await db.query(`
      UPDATE wp_wc_product_meta_lookup
      SET min_price = ?, max_price = ?, sku = ?
      WHERE product_id = ?
    `, [minPrice, maxPrice, sku, parentId]);
  } else {
    await db.query(`
      INSERT INTO wp_wc_product_meta_lookup (product_id, sku, min_price, max_price)
      VALUES (?, ?, ?, ?)
    `, [parentId, sku, minPrice, maxPrice]);
  }
}

/**
 * Build a _product_attributes PHP array for a single variation attribute.
 */
export function buildProductAttributesMeta(
  taxonomy: string,
  values: string[],
  position: number = 0
): Record<string, any> {
  const valueStr = values.join(' | ');
  return {
    [taxonomy]: {
      name: taxonomy,
      value: valueStr,
      position,
      is_visible: 1,
      is_variation: 1,
      is_taxonomy: 1,
    },
  };
}
