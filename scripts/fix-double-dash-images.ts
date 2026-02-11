/**
 * Fix double-dash image filenames (--1, --2, --3 → -1, -2, -3)
 *
 * Updates:
 *  1. Physical files on disk (rename)
 *  2. wp_posts: guid, post_name
 *  3. wp_postmeta: _wp_attached_file
 *  4. wp_postmeta: _wp_attachment_metadata (serialized PHP)
 *
 * For conflicts (single-dash version already exists):
 *  - Reassign _thumbnail_id and _product_image_gallery references
 *  - Delete the double-dash duplicate attachment + file
 *
 * Usage:
 *   bun run scripts/fix-double-dash-images.ts --dry-run
 *   bun run scripts/fix-double-dash-images.ts --apply
 */
import { getConnection } from './lib/db';
import { rename, unlink, access } from 'fs/promises';
import { join } from 'path';

const UPLOADS_BASE = `${process.env.HOME}/Local Sites/maleq-local/app/public/wp-content/uploads`;
const SITE_URL = 'http://maleq-local.local/wp-content/uploads';

const dryRun = !process.argv.includes('--apply');

interface Attachment {
  ID: number;
  post_name: string;
  guid: string;
  attached_file: string; // e.g. 2026/01/name--1.webp
}

interface Conflict {
  ddAttachment: Attachment;
  singleId: number;
}

async function main() {
  const db = await getConnection();

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log('');

  // 1. Get all double-dash attachments with their file paths
  const [rows] = await db.query(`
    SELECT p.ID, p.post_name, p.guid,
           pm.meta_value as attached_file
    FROM wp_posts p
    JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_wp_attached_file'
    WHERE p.post_type = 'attachment'
      AND p.post_name REGEXP '--[0-9]+$'
    ORDER BY p.ID
  `) as [Attachment[], unknown];

  console.log(`Found ${rows.length} double-dash attachments`);

  // 2. Find conflicts - where single-dash version already exists
  const conflictMap = new Map<number, number>(); // dd_id → single_id
  if (rows.length > 0) {
    const [conflictRows] = await db.query(`
      SELECT p1.ID as dd_id, p2.ID as single_id
      FROM wp_posts p1
      JOIN wp_posts p2 ON REPLACE(p1.post_name, '--', '-') = p2.post_name
        AND p1.ID != p2.ID
        AND p2.post_type = 'attachment'
      WHERE p1.post_type = 'attachment'
        AND p1.post_name REGEXP '--[0-9]+$'
    `) as [Array<{ dd_id: number; single_id: number }>, unknown];

    for (const row of conflictRows) {
      conflictMap.set(row.dd_id, row.single_id);
    }
  }

  const renames: Attachment[] = [];
  const conflicts: Conflict[] = [];

  for (const att of rows) {
    if (conflictMap.has(att.ID)) {
      conflicts.push({ ddAttachment: att, singleId: conflictMap.get(att.ID)! });
    } else {
      renames.push(att);
    }
  }

  console.log(`  - ${renames.length} to rename (no conflict)`);
  console.log(`  - ${conflicts.length} conflicts (single-dash already exists)`);
  console.log('');

  // 3. Process renames
  let renameOk = 0;
  let renameErr = 0;

  for (const att of renames) {
    const newPostName = att.post_name.replace(/--(\d+)$/, '-$1');
    const newAttachedFile = att.attached_file.replace(/--(\d+)\.webp$/, '-$1.webp');
    const newGuid = att.guid.replace(/--(\d+)\.webp$/, '-$1.webp');

    const oldPath = join(UPLOADS_BASE, att.attached_file);
    const newPath = join(UPLOADS_BASE, newAttachedFile);

    if (dryRun) {
      if (renameOk < 5) {
        console.log(`  RENAME: ${att.post_name} → ${newPostName}`);
      }
      renameOk++;
      continue;
    }

    try {
      // Rename physical file
      try {
        await access(oldPath);
        await rename(oldPath, newPath);
      } catch {
        // File might not exist on disk - still fix DB
      }

      // Update wp_posts
      await db.query(
        `UPDATE wp_posts SET post_name = ?, guid = ? WHERE ID = ?`,
        [newPostName, newGuid, att.ID]
      );

      // Update _wp_attached_file
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_wp_attached_file'`,
        [newAttachedFile, att.ID]
      );

      // Update _wp_attachment_metadata (serialized PHP - replace filename inside)
      const [metaRows] = await db.query(
        `SELECT meta_id, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wp_attachment_metadata'`,
        [att.ID]
      ) as [Array<{ meta_id: number; meta_value: string }>, unknown];

      for (const meta of metaRows) {
        const oldFilename = att.attached_file.split('/').pop()!;
        const newFilename = newAttachedFile.split('/').pop()!;
        if (meta.meta_value.includes(oldFilename)) {
          // Fix serialized string lengths: replace filename and fix surrounding s:N:"..." lengths
          const updated = fixSerializedFilename(meta.meta_value, oldFilename, newFilename);
          await db.query(
            `UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?`,
            [updated, meta.meta_id]
          );
        }
      }

      renameOk++;
    } catch (err) {
      renameErr++;
      if (renameErr <= 5) {
        console.error(`  ERROR renaming ${att.post_name}:`, (err as Error).message);
      }
    }
  }

  if (dryRun && renameOk > 5) {
    console.log(`  ... and ${renameOk - 5} more renames`);
  }
  console.log(`Renames: ${renameOk} ok, ${renameErr} errors`);
  console.log('');

  // 4. Process conflicts - reassign refs from dd to single, then delete dd
  let conflictOk = 0;
  let conflictErr = 0;

  for (const { ddAttachment, singleId } of conflicts) {
    if (dryRun) {
      if (conflictOk < 5) {
        console.log(`  CONFLICT: ${ddAttachment.post_name} (${ddAttachment.ID}) → merge into ${singleId}`);
      }
      conflictOk++;
      continue;
    }

    try {
      // Reassign _thumbnail_id references
      await db.query(
        `UPDATE wp_postmeta SET meta_value = ? WHERE meta_key = '_thumbnail_id' AND meta_value = ?`,
        [String(singleId), String(ddAttachment.ID)]
      );

      // Reassign _product_image_gallery references
      const [galleryRows] = await db.query(
        `SELECT post_id, meta_value FROM wp_postmeta
         WHERE meta_key = '_product_image_gallery' AND FIND_IN_SET(?, meta_value)`,
        [String(ddAttachment.ID)]
      ) as [Array<{ post_id: number; meta_value: string }>, unknown];

      for (const gal of galleryRows) {
        const ids = gal.meta_value.split(',');
        const updated = ids.map((id: string) =>
          id.trim() === String(ddAttachment.ID) ? String(singleId) : id
        ).join(',');
        await db.query(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
          [updated, gal.post_id]
        );
      }

      // Delete dd attachment's postmeta
      await db.query(`DELETE FROM wp_postmeta WHERE post_id = ?`, [ddAttachment.ID]);
      // Delete dd attachment post
      await db.query(`DELETE FROM wp_posts WHERE ID = ?`, [ddAttachment.ID]);

      // Delete physical file
      const oldPath = join(UPLOADS_BASE, ddAttachment.attached_file);
      try {
        await access(oldPath);
        await unlink(oldPath);
      } catch {
        // File might not exist
      }

      conflictOk++;
    } catch (err) {
      conflictErr++;
      if (conflictErr <= 5) {
        console.error(`  ERROR resolving conflict ${ddAttachment.post_name}:`, (err as Error).message);
      }
    }
  }

  if (dryRun && conflictOk > 5) {
    console.log(`  ... and ${conflictOk - 5} more conflicts`);
  }
  console.log(`Conflicts resolved: ${conflictOk} ok, ${conflictErr} errors`);

  // 5. Summary
  console.log('');
  console.log('=== Summary ===');
  console.log(`Renames: ${renameOk} (files + DB updated)`);
  console.log(`Conflicts: ${conflictOk} (merged to single-dash, dd deleted)`);
  if (dryRun) {
    console.log('');
    console.log('This was a DRY RUN. Run with --apply to make changes.');
  }

  await db.end();
}

/**
 * Replace a filename inside serialized PHP data, fixing s:N:"..." string lengths
 */
function fixSerializedFilename(serialized: string, oldName: string, newName: string): string {
  // PHP serialized strings look like s:42:"2026/01/name--1.webp";
  // When we change the filename, the length changes
  const lengthDiff = oldName.length - newName.length; // positive = shorter new name

  // Replace all occurrences of the old filename, adjusting serialized string lengths
  let result = serialized;
  const regex = new RegExp(`s:(\\d+):"([^"]*${escapeRegex(oldName)}[^"]*)"`, 'g');

  result = result.replace(regex, (match, lengthStr, value) => {
    const newValue = value.replace(oldName, newName);
    return `s:${newValue.length}:"${newValue}"`;
  });

  // Also handle cases where the filename appears without the s:N wrapper
  // (shouldn't happen in WP serialized data, but just in case)
  if (!regex.test(serialized)) {
    result = serialized.replace(oldName, newName);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
