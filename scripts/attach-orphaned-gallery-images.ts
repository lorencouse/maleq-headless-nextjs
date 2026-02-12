#!/usr/bin/env bun

/**
 * Attach Orphaned Gallery Images
 *
 * Finds existing attachment images that belong to product variations
 * but aren't linked to the parent product's gallery. These are images
 * that were imported during the original product import (image[1+] for
 * each variation) but never added to _product_image_gallery.
 *
 * For each variable product:
 * 1. Gets each variation's thumbnail attachment
 * 2. Derives the base filename pattern (e.g., "product-name-color-")
 * 3. Finds sibling attachments with higher indices (image 2, 3, etc.)
 * 4. Adds them to the parent product's gallery if not already there
 *
 * Usage:
 *   bun scripts/attach-orphaned-gallery-images.ts --dry-run
 *   bun scripts/attach-orphaned-gallery-images.ts
 *   bun scripts/attach-orphaned-gallery-images.ts --product-id 197752
 */

import { getConnection } from './lib/db';
import type { Connection } from 'mysql2/promise';

const DRY_RUN = process.argv.includes('--dry-run');
const PRODUCT_ID_ARG = process.argv.indexOf('--product-id');
const SPECIFIC_PRODUCT_ID = PRODUCT_ID_ARG >= 0 ? parseInt(process.argv[PRODUCT_ID_ARG + 1], 10) : null;

interface OrphanResult {
  parentId: number;
  parentTitle: string;
  currentGalleryIds: number[];
  orphanedIds: number[];
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Attach Orphaned Gallery Images');
  console.log('='.repeat(60));
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (SPECIFIC_PRODUCT_ID) console.log(`  Product ID: ${SPECIFIC_PRODUCT_ID}`);
  console.log();

  const connection = await getConnection();
  console.log('Connected to database\n');

  // Step 1: Get all variable products
  let query = `
    SELECT
      p.ID as parentId,
      p.post_title as parentTitle,
      pm_thumb.meta_value as thumbnailId,
      pm_gallery.meta_value as galleryIds
    FROM wp_posts p
    INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
    INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    INNER JOIN wp_terms t ON tt.term_id = t.term_id
    LEFT JOIN wp_postmeta pm_thumb ON p.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pm_gallery ON p.ID = pm_gallery.post_id AND pm_gallery.meta_key = '_product_image_gallery'
    WHERE p.post_type = 'product'
      AND p.post_status = 'publish'
      AND tt.taxonomy = 'product_type'
      AND t.slug = 'variable'
  `;

  const params: any[] = [];
  if (SPECIFIC_PRODUCT_ID) {
    query += ' AND p.ID = ?';
    params.push(SPECIFIC_PRODUCT_ID);
  }
  query += ' ORDER BY p.ID';

  const [products] = await connection.execute(query, params);
  const productRows = products as any[];
  console.log(`Found ${productRows.length} variable products to scan\n`);

  let totalOrphaned = 0;
  let productsWithOrphans = 0;
  let productsUpdated = 0;
  const results: OrphanResult[] = [];

  for (let pi = 0; pi < productRows.length; pi++) {
    const product = productRows[pi];
    const parentId = product.parentId;
    const parentTitle = product.parentTitle;
    const parentThumbId = product.thumbnailId ? parseInt(product.thumbnailId, 10) : null;

    const galleryStr = product.galleryIds || '';
    const currentGalleryIds = galleryStr
      ? galleryStr.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id) && id > 0)
      : [];
    const gallerySet = new Set(currentGalleryIds);

    // Get variation thumbnail IDs
    const [variations] = await connection.execute(
      `SELECT v.ID, pm_thumb.meta_value as thumbnailId
       FROM wp_posts v
       LEFT JOIN wp_postmeta pm_thumb ON v.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
       WHERE v.post_parent = ? AND v.post_type = 'product_variation' AND v.post_status = 'publish'`,
      [parentId]
    );

    const variationRows = variations as any[];
    if (variationRows.length === 0) continue;

    // Collect all orphaned attachment IDs for this product
    const orphanedIds: number[] = [];

    for (const variation of variationRows) {
      const thumbId = variation.thumbnailId ? parseInt(variation.thumbnailId, 10) : null;
      if (!thumbId || thumbId <= 0) continue;

      // Get the thumbnail attachment's post_name to derive the base pattern
      const [thumbAttachment] = await connection.execute(
        `SELECT post_name FROM wp_posts WHERE ID = ? AND post_type = 'attachment'`,
        [thumbId]
      );

      const thumbRows = thumbAttachment as any[];
      if (thumbRows.length === 0) continue;

      const thumbName = thumbRows[0].post_name as string;

      // Derive base pattern: strip trailing -N or --N (the image index)
      // Examples:
      //   "sensuelle-luna-velvet-touch-vibe-emerald-green--1" → "sensuelle-luna-velvet-touch-vibe-emerald-green-"
      //   "some-product-name-3" → "some-product-name-"
      const basePattern = thumbName.replace(/-?\d+$/, '');
      if (!basePattern || basePattern === thumbName) continue;

      // Find sibling attachments with the same base pattern
      const [siblings] = await connection.execute(
        `SELECT ID, post_name FROM wp_posts
         WHERE post_type = 'attachment'
           AND post_name LIKE ?
           AND ID != ?
         ORDER BY post_name`,
        [`${basePattern}%`, thumbId]
      );

      const siblingRows = siblings as any[];

      for (const sibling of siblingRows) {
        const sibId = sibling.ID as number;
        // Skip if already in gallery, is the parent thumbnail, or already collected
        if (gallerySet.has(sibId) || sibId === parentThumbId || orphanedIds.includes(sibId)) continue;

        // Verify it's a numbered sibling (not some unrelated match)
        // Suffix may be "2", "-2", etc. depending on single/double dash naming
        const suffix = (sibling.post_name as string).slice(basePattern.length);
        if (/^-?\d+$/.test(suffix)) {
          orphanedIds.push(sibId);
        }
      }
    }

    if (orphanedIds.length === 0) continue;

    productsWithOrphans++;
    totalOrphaned += orphanedIds.length;

    if (orphanedIds.length <= 6) {
      console.log(`[${parentId}] ${parentTitle} — ${orphanedIds.length} orphaned images (IDs: ${orphanedIds.join(', ')})`);
    } else {
      console.log(`[${parentId}] ${parentTitle} — ${orphanedIds.length} orphaned images`);
    }

    results.push({ parentId, parentTitle, currentGalleryIds, orphanedIds });

    if (!DRY_RUN) {
      // Append orphaned IDs to gallery
      const newGallery = [...currentGalleryIds, ...orphanedIds];
      const galleryValue = newGallery.join(',');

      const [existing] = await connection.execute(
        `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
        [parentId]
      );

      if ((existing as any[]).length > 0) {
        await connection.execute(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
          [galleryValue, parentId]
        );
      } else {
        await connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
          [parentId, galleryValue]
        );
      }

      productsUpdated++;
    }

    // Progress every 500
    if ((pi + 1) % 500 === 0) {
      console.log(`--- Scanned ${pi + 1}/${productRows.length} products, found ${productsWithOrphans} with orphans (${totalOrphaned} images) ---`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('ORPHANED GALLERY IMAGES SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Mode:                 ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Products scanned:     ${productRows.length}`);
  console.log(`  Products with orphans: ${productsWithOrphans}`);
  console.log(`  Products updated:     ${productsUpdated}`);
  console.log(`  Orphaned images found: ${totalOrphaned}`);
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\nThis was a dry run. Run without --dry-run to apply changes.');
  }

  await connection.end();
  console.log('\nDone.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
