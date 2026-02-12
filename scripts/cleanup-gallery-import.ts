#!/usr/bin/env bun

/**
 * Cleanup script for the broken gallery image import.
 *
 * Reverts the changes made by import-variation-gallery-images.ts:
 * 1. Finds all attachment posts with 'gallery' in guid created on/after 2026-02-11
 * 2. Removes those attachment IDs from _product_image_gallery meta values
 * 3. Deletes the attachment wp_postmeta rows
 * 4. Deletes the attachment wp_posts rows
 * 5. Deletes the physical gallery files from uploads/2026/02/
 *
 * Usage:
 *   bun scripts/cleanup-gallery-import.ts --dry-run   # preview only
 *   bun scripts/cleanup-gallery-import.ts              # execute cleanup
 */

import { getConnection } from './lib/db';
import type { Connection } from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Cleanup Gallery Image Import');
  console.log('='.repeat(60));
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  const connection = await getConnection();
  console.log('Connected to database\n');

  // Step 1: Find all gallery attachments created by the script
  console.log('Step 1: Finding gallery attachments...');
  const [attachments] = await connection.execute(
    `SELECT ID, guid, post_date
     FROM wp_posts
     WHERE post_type = 'attachment'
       AND post_mime_type = 'image/webp'
       AND guid LIKE '%gallery%'
       AND post_date >= '2026-02-11 00:00:00'
     ORDER BY ID`
  );

  const attachmentRows = attachments as any[];
  console.log(`  Found ${attachmentRows.length} gallery attachments to remove\n`);

  if (attachmentRows.length === 0) {
    console.log('Nothing to clean up. Exiting.');
    await connection.end();
    return;
  }

  const attachmentIds = attachmentRows.map((r: any) => r.ID);
  const attachmentIdSet = new Set(attachmentIds);
  const minId = Math.min(...attachmentIds);
  const maxId = Math.max(...attachmentIds);
  console.log(`  Attachment ID range: ${minId} - ${maxId}`);

  // Step 2: Clean up _product_image_gallery meta values
  console.log('\nStep 2: Cleaning _product_image_gallery meta values...');
  const [galleryMetas] = await connection.execute(
    `SELECT meta_id, post_id, meta_value
     FROM wp_postmeta
     WHERE meta_key = '_product_image_gallery'
       AND meta_value != ''`
  );

  const galleryRows = galleryMetas as any[];
  let galleriesUpdated = 0;
  let galleriesCleared = 0;

  for (const row of galleryRows) {
    const ids = (row.meta_value as string)
      .split(',')
      .map((id: string) => parseInt(id.trim(), 10))
      .filter((id: number) => !isNaN(id) && id > 0);

    const cleanedIds = ids.filter((id: number) => !attachmentIdSet.has(id));

    if (cleanedIds.length === ids.length) continue; // No change needed

    if (cleanedIds.length === 0) {
      // Gallery would be empty — clear it
      if (!DRY_RUN) {
        await connection.execute(
          `UPDATE wp_postmeta SET meta_value = '' WHERE meta_id = ?`,
          [row.meta_id]
        );
      }
      galleriesCleared++;
    } else {
      const newValue = cleanedIds.join(',');
      if (!DRY_RUN) {
        await connection.execute(
          `UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`,
          [newValue, row.meta_id]
        );
      }
      galleriesUpdated++;
    }
  }

  console.log(`  Galleries updated: ${galleriesUpdated}`);
  console.log(`  Galleries cleared: ${galleriesCleared}`);

  // Step 3: Delete attachment postmeta
  console.log('\nStep 3: Deleting attachment postmeta...');

  // Process in batches of 500 to avoid query size limits
  const batchSize = 500;
  let metaDeleted = 0;

  for (let i = 0; i < attachmentIds.length; i += batchSize) {
    const batch = attachmentIds.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');

    if (!DRY_RUN) {
      const [result] = await connection.execute(
        `DELETE FROM wp_postmeta WHERE post_id IN (${placeholders})`,
        batch
      );
      metaDeleted += (result as any).affectedRows;
    } else {
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE post_id IN (${placeholders})`,
        batch
      );
      metaDeleted += (countResult as any[])[0].cnt;
    }
  }

  console.log(`  Postmeta rows ${DRY_RUN ? 'to delete' : 'deleted'}: ${metaDeleted}`);

  // Step 4: Delete attachment posts
  console.log('\nStep 4: Deleting attachment posts...');
  let postsDeleted = 0;

  for (let i = 0; i < attachmentIds.length; i += batchSize) {
    const batch = attachmentIds.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');

    if (!DRY_RUN) {
      const [result] = await connection.execute(
        `DELETE FROM wp_posts WHERE ID IN (${placeholders})`,
        batch
      );
      postsDeleted += (result as any).affectedRows;
    } else {
      postsDeleted += batch.length;
    }
  }

  console.log(`  Attachment posts ${DRY_RUN ? 'to delete' : 'deleted'}: ${postsDeleted}`);

  // Step 5: Delete physical files
  console.log('\nStep 5: Deleting gallery image files...');
  const uploadsDir = path.join(WP_UPLOADS_DIR, '2026', '02');
  let filesDeleted = 0;
  let filesNotFound = 0;

  if (fs.existsSync(uploadsDir)) {
    const allFiles = fs.readdirSync(uploadsDir);
    const galleryFiles = allFiles.filter(f => f.includes('gallery'));

    console.log(`  Found ${galleryFiles.length} gallery files in uploads/2026/02/`);

    for (const file of galleryFiles) {
      const filePath = path.join(uploadsDir, file);
      if (!DRY_RUN) {
        try {
          fs.unlinkSync(filePath);
          filesDeleted++;
        } catch (err) {
          console.error(`    Failed to delete: ${file}`);
        }
      } else {
        filesDeleted++;
      }
    }
  }

  console.log(`  Files ${DRY_RUN ? 'to delete' : 'deleted'}: ${filesDeleted}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('CLEANUP SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Mode:              ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Attachments:       ${postsDeleted}`);
  console.log(`  Postmeta rows:     ${metaDeleted}`);
  console.log(`  Galleries updated: ${galleriesUpdated}`);
  console.log(`  Galleries cleared: ${galleriesCleared}`);
  console.log(`  Files deleted:     ${filesDeleted}`);
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
