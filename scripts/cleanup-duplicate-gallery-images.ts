#!/usr/bin/env bun

/**
 * Cleanup Duplicate Gallery Images (Bulk)
 *
 * Finds hash-suffixed duplicate attachments (-[a-f0-9]{8}.webp), maps them
 * back to their originals, replaces references in featured images and galleries,
 * then deletes the duplicate attachments and files from disk.
 *
 * Usage:
 *   bun scripts/cleanup-duplicate-gallery-images.ts --analyze
 *   bun scripts/cleanup-duplicate-gallery-images.ts --dry-run
 *   bun scripts/cleanup-duplicate-gallery-images.ts --apply
 *
 * Options:
 *   --analyze   Show analysis of duplicate images (default)
 *   --dry-run   Show what would be cleaned up without making changes
 *   --apply     Actually remove duplicates and update references
 */

import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConnection } from './lib/db';
const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';

type Mode = 'analyze' | 'dry-run' | 'apply';

function parseArgs(): { mode: Mode } {
  const args = process.argv.slice(2);
  let mode: Mode = 'analyze';

  for (const arg of args) {
    if (arg === '--analyze') mode = 'analyze';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--apply') mode = 'apply';
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Cleanup Duplicate Gallery Images (Bulk)

Removes hash-suffixed duplicate attachments and updates all references
(featured images and gallery meta) to point to the originals.

Usage:
  bun scripts/cleanup-duplicate-gallery-images.ts [mode]

Modes:
  --analyze   Show analysis of duplicates (default)
  --dry-run   Show what would be cleaned up
  --apply     Remove duplicates and update references
      `);
      process.exit(0);
    }
  }

  return { mode };
}

async function main() {
  const { mode } = parseArgs();

  console.log('\n========================================');
  console.log('  Cleanup Duplicate Gallery Images');
  console.log('========================================\n');
  console.log(`Mode: ${mode}\n`);

  const connection = await getConnection();

  console.log('Connected to database\n');

  try {
    // Step 1: Build mapping of hash-suffixed attachment ID -> original attachment ID
    console.log('Step 1: Finding all hash-suffixed duplicate attachments...');

    const [hashRows] = await connection.execute(`
      SELECT
        dup.post_id as dup_id,
        dup.meta_value as dup_file,
        REGEXP_REPLACE(dup.meta_value, '-[a-f0-9]{8}\\.webp$', '.webp') as original_file
      FROM wp_postmeta dup
      WHERE dup.meta_key = '_wp_attached_file'
        AND dup.meta_value REGEXP '-[a-f0-9]{8}\\.webp$'
    `);

    const duplicates = hashRows as Array<{ dup_id: number; dup_file: string; original_file: string }>;
    console.log(`  Found ${duplicates.length} hash-suffixed attachments\n`);

    if (duplicates.length === 0) {
      console.log('No duplicates found!');
      return;
    }

    // Step 2: Look up original attachment IDs for each original_file
    console.log('Step 2: Mapping duplicates to originals...');

    // Build a lookup of original_file -> original_id
    const uniqueOriginalFiles = [...new Set(duplicates.map(d => d.original_file))];
    console.log(`  ${uniqueOriginalFiles.length} unique original filenames to look up`);

    // Query in batches of 500
    const originalFileToId = new Map<string, number>();
    for (let i = 0; i < uniqueOriginalFiles.length; i += 500) {
      const batch = uniqueOriginalFiles.slice(i, i + 500);
      const placeholders = batch.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT post_id, meta_value FROM wp_postmeta
         WHERE meta_key = '_wp_attached_file' AND meta_value IN (${placeholders})`,
        batch
      );
      for (const row of rows as any[]) {
        // If multiple originals exist for the same file, use the lowest ID (first created)
        if (!originalFileToId.has(row.meta_value) || row.post_id < originalFileToId.get(row.meta_value)!) {
          originalFileToId.set(row.meta_value, row.post_id);
        }
      }
      if (i % 5000 === 0 && i > 0) {
        console.log(`  Looked up ${i}/${uniqueOriginalFiles.length}...`);
      }
    }

    console.log(`  Found originals for ${originalFileToId.size} files\n`);

    // Build dup_id -> original_id mapping
    const dupToOriginal = new Map<number, number>();
    let noOriginalCount = 0;

    for (const dup of duplicates) {
      const originalId = originalFileToId.get(dup.original_file);
      if (originalId && originalId !== dup.dup_id) {
        dupToOriginal.set(dup.dup_id, originalId);
      } else {
        noOriginalCount++;
      }
    }

    console.log(`  Mapped ${dupToOriginal.size} duplicates to originals`);
    if (noOriginalCount > 0) {
      console.log(`  ${noOriginalCount} duplicates have no matching original (will keep)`);
    }
    console.log();

    if (mode === 'analyze') {
      // Just show stats
      console.log('=== Analysis ===');
      console.log(`Total hash-suffixed attachments: ${duplicates.length}`);
      console.log(`Mappable to originals: ${dupToOriginal.size}`);
      console.log(`No original found: ${noOriginalCount}`);

      // Check how many are used as featured images
      const dupIds = [...dupToOriginal.keys()];
      let featuredCount = 0;
      for (let i = 0; i < dupIds.length; i += 1000) {
        const batch = dupIds.slice(i, i + 1000);
        const placeholders = batch.map(() => '?').join(',');
        const [rows] = await connection.execute(
          `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE meta_key = '_thumbnail_id' AND meta_value IN (${placeholders})`,
          batch.map(String)
        );
        featuredCount += (rows as any[])[0].cnt;
      }

      // Check how many are in galleries
      const [galleryRows] = await connection.execute(
        `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE meta_key = '_product_image_gallery' AND meta_value != ''`
      );
      const totalGalleries = (galleryRows as any[])[0].cnt;

      console.log(`\nDuplicates used as featured images: ${featuredCount}`);
      console.log(`Total product galleries to scan: ${totalGalleries}`);
      console.log(`\nRun with --dry-run to see detailed changes, or --apply to fix.`);
      return;
    }

    // Step 3: Update featured images (_thumbnail_id)
    console.log('Step 3: Updating featured image references...');
    let featuredUpdated = 0;

    // Process in batches
    const dupIds = [...dupToOriginal.keys()];
    for (let i = 0; i < dupIds.length; i += 500) {
      const batch = dupIds.slice(i, i + 500);
      const placeholders = batch.map(() => '?').join(',');

      const [thumbRows] = await connection.execute(
        `SELECT meta_id, meta_value FROM wp_postmeta
         WHERE meta_key = '_thumbnail_id' AND meta_value IN (${placeholders})`,
        batch.map(String)
      );

      for (const row of thumbRows as any[]) {
        const dupId = parseInt(row.meta_value, 10);
        const originalId = dupToOriginal.get(dupId);
        if (!originalId) continue;

        featuredUpdated++;
        if (mode === 'dry-run') {
          if (featuredUpdated <= 5) {
            console.log(`  Would update thumbnail: ${dupId} -> ${originalId}`);
          }
        } else {
          await connection.execute(
            `UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`,
            [originalId.toString(), row.meta_id]
          );
        }
      }

      if (i % 5000 === 0 && i > 0) {
        console.log(`  Processed ${i}/${dupIds.length} batches...`);
      }
    }

    console.log(`  Featured images ${mode === 'apply' ? 'updated' : 'to update'}: ${featuredUpdated}\n`);

    // Step 4: Update gallery meta (_product_image_gallery)
    console.log('Step 4: Updating product gallery references...');

    const [allGalleries] = await connection.execute(
      `SELECT meta_id, post_id, meta_value FROM wp_postmeta WHERE meta_key = '_product_image_gallery' AND meta_value != ''`
    );

    let galleriesUpdated = 0;
    let galleryIdsRemoved = 0;

    for (const gallery of allGalleries as any[]) {
      const ids = gallery.meta_value.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));

      // Replace duplicate IDs with original IDs, then deduplicate
      const newIds: number[] = [];
      const seen = new Set<number>();

      for (const id of ids) {
        const resolvedId = dupToOriginal.get(id) || id;
        if (!seen.has(resolvedId)) {
          seen.add(resolvedId);
          newIds.push(resolvedId);
        }
      }

      if (newIds.length !== ids.length || newIds.some((id, idx) => id !== ids[idx])) {
        galleriesUpdated++;
        galleryIdsRemoved += ids.length - newIds.length;

        if (mode === 'dry-run' && galleriesUpdated <= 5) {
          console.log(`  Product #${gallery.post_id}: ${ids.length} -> ${newIds.length} gallery images`);
        }

        if (mode === 'apply') {
          await connection.execute(
            `UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`,
            [newIds.join(','), gallery.meta_id]
          );
        }
      }
    }

    console.log(`  Galleries ${mode === 'apply' ? 'updated' : 'to update'}: ${galleriesUpdated}`);
    console.log(`  Duplicate IDs ${mode === 'apply' ? 'removed' : 'to remove'} from galleries: ${galleryIdsRemoved}\n`);

    // Step 5: Delete duplicate attachment posts and meta, remove files from disk
    console.log('Step 5: Deleting duplicate attachments and files...');

    let attachmentsDeleted = 0;
    let filesDeleted = 0;
    let filesNotFound = 0;

    // Collect file paths before deleting from DB
    const dupFileMap = new Map<number, string>();
    for (const dup of duplicates) {
      if (dupToOriginal.has(dup.dup_id)) {
        dupFileMap.set(dup.dup_id, dup.dup_file);
      }
    }

    if (mode === 'apply') {
      // Delete in batches
      const idsToDelete = [...dupToOriginal.keys()];

      for (let i = 0; i < idsToDelete.length; i += 500) {
        const batch = idsToDelete.slice(i, i + 500);
        const placeholders = batch.map(() => '?').join(',');

        // Delete postmeta
        await connection.execute(
          `DELETE FROM wp_postmeta WHERE post_id IN (${placeholders})`,
          batch
        );

        // Delete posts
        await connection.execute(
          `DELETE FROM wp_posts WHERE ID IN (${placeholders})`,
          batch
        );

        attachmentsDeleted += batch.length;

        if (i % 5000 === 0 && i > 0) {
          console.log(`  Deleted ${i}/${idsToDelete.length} attachments from DB...`);
        }
      }

      // Delete files from disk
      console.log(`  Removing files from disk...`);
      for (const [dupId, filePath] of dupFileMap) {
        const fullPath = join(WP_UPLOADS_DIR, filePath);
        if (existsSync(fullPath)) {
          try {
            unlinkSync(fullPath);
            filesDeleted++;
          } catch {
            // Skip if can't delete
          }
        } else {
          filesNotFound++;
        }

        if (filesDeleted % 10000 === 0 && filesDeleted > 0) {
          console.log(`  Deleted ${filesDeleted} files from disk...`);
        }
      }
    } else {
      attachmentsDeleted = dupToOriginal.size;
      // Check how many files exist on disk
      for (const [, filePath] of dupFileMap) {
        const fullPath = join(WP_UPLOADS_DIR, filePath);
        if (existsSync(fullPath)) {
          filesDeleted++;
        } else {
          filesNotFound++;
        }
      }
    }

    console.log(`  Attachments ${mode === 'apply' ? 'deleted' : 'to delete'}: ${attachmentsDeleted}`);
    console.log(`  Files ${mode === 'apply' ? 'deleted' : 'to delete'} from disk: ${filesDeleted}`);
    if (filesNotFound > 0) {
      console.log(`  Files not found on disk: ${filesNotFound}`);
    }

    // Final summary
    console.log('\n=== Summary ===');
    console.log(`Featured images ${mode === 'apply' ? 'updated' : 'to update'}: ${featuredUpdated}`);
    console.log(`Galleries ${mode === 'apply' ? 'updated' : 'to update'}: ${galleriesUpdated}`);
    console.log(`Duplicate gallery entries ${mode === 'apply' ? 'removed' : 'to remove'}: ${galleryIdsRemoved}`);
    console.log(`Duplicate attachments ${mode === 'apply' ? 'deleted' : 'to delete'}: ${attachmentsDeleted}`);
    console.log(`Files ${mode === 'apply' ? 'removed' : 'to remove'} from disk: ${filesDeleted}`);

    if (mode === 'dry-run') {
      console.log('\nRun with --apply to execute these changes.');
    }
  } finally {
    await connection.end();
  }

  console.log('\nDone!');
}

main().catch(error => {
  console.error('\nFailed:', error);
  process.exit(1);
});
