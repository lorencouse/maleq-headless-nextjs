#!/usr/bin/env bun

/**
 * Fix Orphaned Variation Images
 *
 * Finds variation thumbnails that are not in their parent product's gallery
 * and appends them. This ensures WooCommerce displays all variation images
 * in the product gallery.
 *
 * Usage:
 *   bun scripts/fix-orphaned-variation-images.ts --local   # local DB
 *   bun scripts/fix-orphaned-variation-images.ts            # production DB
 *   bun scripts/fix-orphaned-variation-images.ts --dry-run  # preview only
 */

import { getConnection } from './lib/db';
import type { RowDataPacket } from 'mysql2/promise';

const args = process.argv.slice(2);
const useLocal = args.includes('--local');
const dryRun = args.includes('--dry-run');

interface OrphanRow extends RowDataPacket {
  parent_id: number;
  parent_thumb: string;
  gallery: string;
  var_thumbs: string;
}

async function main() {
  const conn = await getConnection(useLocal);
  console.log(`Connected to ${useLocal ? 'LOCAL' : 'PRODUCTION'} database`);
  if (dryRun) console.log('DRY RUN — no changes will be made\n');

  // Find all parents where variations have thumbnails not in the gallery
  const [rows] = await conn.query<OrphanRow[]>(`
    SELECT
      v.post_parent AS parent_id,
      MAX(COALESCE(pthumb.meta_value, '')) AS parent_thumb,
      MAX(COALESCE(pgal.meta_value, '')) AS gallery,
      GROUP_CONCAT(DISTINCT vthumb.meta_value) AS var_thumbs
    FROM wp_posts v
    JOIN wp_postmeta vthumb ON vthumb.post_id = v.ID AND vthumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pgal ON pgal.post_id = v.post_parent AND pgal.meta_key = '_product_image_gallery'
    LEFT JOIN wp_postmeta pthumb ON pthumb.post_id = v.post_parent AND pthumb.meta_key = '_thumbnail_id'
    WHERE v.post_type = 'product_variation'
      AND v.post_status = 'publish'
      AND vthumb.meta_value != '' AND vthumb.meta_value != '0'
      AND vthumb.meta_value != COALESCE(pthumb.meta_value, '')
      AND NOT FIND_IN_SET(vthumb.meta_value, COALESCE(pgal.meta_value, ''))
    GROUP BY v.post_parent
  `);

  console.log(`Found ${rows.length} parents with orphaned variation images\n`);

  let updated = 0;
  let created = 0;
  let totalImagesAdded = 0;

  for (const row of rows) {
    const existingGallery = row.gallery ? row.gallery.split(',').filter(Boolean) : [];
    const parentThumb = row.parent_thumb;
    const varThumbs = row.var_thumbs.split(',').filter(Boolean);

    // Filter to only truly orphaned IDs (not already in gallery, not the parent thumb)
    const existingSet = new Set([...existingGallery, parentThumb]);
    const newImages = varThumbs.filter(id => !existingSet.has(id));

    if (newImages.length === 0) continue;

    const updatedGallery = [...existingGallery, ...newImages].join(',');
    totalImagesAdded += newImages.length;

    if (dryRun) {
      if (updated < 20) {
        console.log(`  [${row.parent_id}] gallery: ${existingGallery.length} → ${existingGallery.length + newImages.length} images (+${newImages.length})`);
      }
    } else {
      if (existingGallery.length > 0) {
        // Update existing gallery
        await conn.query(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
          [updatedGallery, row.parent_id]
        );
        updated++;
      } else {
        // No gallery row exists — check if meta row exists but is empty, or doesn't exist at all
        const [existing] = await conn.query<RowDataPacket[]>(
          `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
          [row.parent_id]
        );
        if (existing.length > 0) {
          await conn.query(
            `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
            [updatedGallery, row.parent_id]
          );
          updated++;
        } else {
          await conn.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
            [row.parent_id, updatedGallery]
          );
          created++;
        }
      }
    }
  }

  if (dryRun && rows.length > 20) {
    console.log(`  ... and ${rows.length - 20} more parents`);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${dryRun ? 'Would update' : 'Updated'}: ${updated + created} parent galleries`);
  console.log(`    Gallery rows updated: ${updated}`);
  console.log(`    Gallery rows created: ${created}`);
  console.log(`  Total images added: ${totalImagesAdded}`);
  console.log('═'.repeat(50));

  await conn.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
