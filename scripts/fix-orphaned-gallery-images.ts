#!/usr/bin/env bun

/**
 * Recover Orphaned Sequential Gallery Images
 *
 * During import, each product's images were downloaded as sequential files
 * (product-name-1.webp through product-name-N.webp) with attachment records
 * created in wp_posts. However, for many variable products, images 2+ were
 * never added to the parent's _product_image_gallery meta.
 *
 * This script finds those orphaned sequential attachments and appends them
 * to the parent's gallery. No downloads needed — pure DB metadata fix.
 *
 * Usage:
 *   bun scripts/fix-orphaned-gallery-images.ts --local --dry-run
 *   bun scripts/fix-orphaned-gallery-images.ts --local --product-id 445969
 *   bun scripts/fix-orphaned-gallery-images.ts --local
 */

import { getConnection } from './lib/db';
import type { Connection, RowDataPacket } from 'mysql2/promise';

interface Options {
  dryRun: boolean;
  limit?: number;
  productId?: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--product-id' && i + 1 < args.length) {
      options.productId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Recover Orphaned Sequential Gallery Images

Finds sequential attachment images (product-name-2.webp, -3.webp, etc.) that
exist as wp_posts attachments but are not in the parent product's gallery.

Usage:
  bun scripts/fix-orphaned-gallery-images.ts --local [options]

Options:
  --local              Use local database
  --dry-run            Preview only
  --limit <n>          Process N parents
  --product-id <id>    Single parent product
  --help, -h           Show this help
      `);
      process.exit(0);
    }
  }

  return options;
}

interface ParentProduct {
  parentId: number;
  parentTitle: string;
  thumbAttachmentId: number;
  thumbFilePath: string; // e.g. "2026/01/bang-10x-mega-vibe-black-1.webp"
  currentGallery: string; // comma-separated IDs or empty
}

interface SequentialAttachment extends RowDataPacket {
  ID: number;
  meta_value: string; // _wp_attached_file path
}

/**
 * Extract the stem prefix from a "-1.webp" filename.
 * E.g. "2026/01/bang-10x-mega-vibe-black-1.webp" -> "2026/01/bang-10x-mega-vibe-black-"
 * Returns null if the file doesn't end with -1.webp (not a sequential image).
 */
function extractStem(filePath: string): string | null {
  const match = filePath.match(/^(.+)-1\.webp$/);
  return match ? match[1] + '-' : null;
}

/**
 * Extract the sequence number from a filename.
 * E.g. "2026/01/bang-10x-mega-vibe-black-3.webp" -> 3
 */
function extractSequenceNumber(filePath: string): number {
  const match = filePath.match(/-(\d+)\.webp$/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getVariableProducts(conn: Connection, options: Options): Promise<ParentProduct[]> {
  let whereExtra = '';
  const params: any[] = [];

  if (options.productId) {
    whereExtra = 'AND parent.ID = ?';
    params.push(options.productId);
  }

  const [rows] = await conn.query<RowDataPacket[]>(`
    SELECT
      parent.ID AS parent_id,
      parent.post_title AS parent_title,
      CAST(COALESCE(pthumb.meta_value, '0') AS UNSIGNED) AS thumb_id,
      COALESCE(pfile.meta_value, '') AS thumb_file,
      COALESCE(pgal.meta_value, '') AS current_gallery
    FROM wp_posts parent
    INNER JOIN wp_term_relationships tr ON parent.ID = tr.object_id
    INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'product_type'
    INNER JOIN wp_terms t ON tt.term_id = t.term_id AND t.slug = 'variable'
    LEFT JOIN wp_postmeta pthumb ON parent.ID = pthumb.post_id AND pthumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pfile ON pfile.post_id = CAST(COALESCE(pthumb.meta_value, '0') AS UNSIGNED) AND pfile.meta_key = '_wp_attached_file'
    LEFT JOIN wp_postmeta pgal ON parent.ID = pgal.post_id AND pgal.meta_key = '_product_image_gallery'
    WHERE parent.post_type = 'product'
      AND parent.post_status = 'publish'
      ${whereExtra}
    ORDER BY parent.ID
  `, params);

  return rows
    .filter(row => row.thumb_id > 0)
    .map(row => ({
      parentId: row.parent_id,
      parentTitle: row.parent_title,
      thumbAttachmentId: row.thumb_id as number,
      thumbFilePath: row.thumb_file || '',
      currentGallery: row.current_gallery || '',
    }));
}

/**
 * Find sequential attachments matching a stem pattern.
 * Looks for attachments with _wp_attached_file like "{stem}2.webp", "{stem}3.webp", etc.
 */
async function findSequentialAttachments(
  conn: Connection,
  stem: string,
): Promise<SequentialAttachment[]> {
  // Query for attachments matching the stem pattern, excluding -1.webp (the original)
  const [rows] = await conn.query<SequentialAttachment[]>(
    `SELECT p.ID, pm.meta_value
     FROM wp_posts p
     JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_wp_attached_file'
     WHERE p.post_type = 'attachment'
       AND p.post_status = 'inherit'
       AND pm.meta_value LIKE ?
       AND pm.meta_value NOT LIKE ?
     ORDER BY pm.meta_value`,
    [`${stem}%.webp`, `${stem}1.webp`]
  );

  // Filter to only truly sequential files (stem + number + .webp, no extra chars)
  return rows.filter(row => {
    const suffix = row.meta_value.substring(stem.length);
    return /^\d+\.webp$/.test(suffix);
  });
}

/**
 * Get all variation thumbnail IDs and their file paths for a parent.
 * Returns both the set of IDs (for exclusion) and the file paths (for stem extraction).
 */
async function getVariationThumbInfo(conn: Connection, parentId: number): Promise<{
  thumbIds: Set<number>;
  thumbFiles: string[];
}> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT DISTINCT CAST(vt.meta_value AS UNSIGNED) AS thumb_id,
            COALESCE(af.meta_value, '') AS thumb_file
     FROM wp_posts v
     JOIN wp_postmeta vt ON vt.post_id = v.ID AND vt.meta_key = '_thumbnail_id'
     LEFT JOIN wp_postmeta af ON af.post_id = CAST(vt.meta_value AS UNSIGNED) AND af.meta_key = '_wp_attached_file'
     WHERE v.post_parent = ? AND v.post_type = 'product_variation'
       AND vt.meta_value != '' AND vt.meta_value != '0'`,
    [parentId]
  );
  return {
    thumbIds: new Set(rows.map(r => r.thumb_id as number)),
    thumbFiles: rows.map(r => r.thumb_file as string).filter(Boolean),
  };
}

async function upsertGallery(conn: Connection, parentId: number, galleryValue: string): Promise<'updated' | 'created'> {
  const [existing] = await conn.query<RowDataPacket[]>(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
    [parentId]
  );

  if (existing.length > 0) {
    await conn.query(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
      [galleryValue, parentId]
    );
    return 'updated';
  } else {
    await conn.query(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
      [parentId, galleryValue]
    );
    return 'created';
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n' + '═'.repeat(55));
  console.log('  Recover Orphaned Sequential Gallery Images');
  console.log('═'.repeat(55) + '\n');

  if (options.dryRun) console.log('DRY RUN — no changes will be made\n');
  if (options.limit) console.log(`Limit: ${options.limit} parents\n`);
  if (options.productId) console.log(`Product ID: ${options.productId}\n`);

  const conn = await getConnection();

  // Step 1: Get all variable products
  console.log('Finding variable products...');
  let products = await getVariableProducts(conn, options);
  console.log(`Found ${products.length} variable products with thumbnails\n`);

  if (options.limit) {
    products = products.slice(0, options.limit);
  }

  let parentsScanned = 0;
  let parentsWithOrphans = 0;
  let totalImagesRecovered = 0;
  let alreadyInGallery = 0;
  let galleryRowsUpdated = 0;
  let galleryRowsCreated = 0;

  for (const product of products) {
    parentsScanned++;

    // Get all variation thumb info (IDs for exclusion, file paths for stem extraction)
    const varInfo = await getVariationThumbInfo(conn, product.parentId);

    // Collect unique stems from: parent thumb + all variation thumbs
    const stemsToCheck: string[] = [];
    const seenStems = new Set<string>();

    const allThumbFiles = [product.thumbFilePath, ...varInfo.thumbFiles];
    for (const file of allThumbFiles) {
      if (!file) continue;
      const stem = extractStem(file);
      if (stem && !seenStems.has(stem)) {
        seenStems.add(stem);
        stemsToCheck.push(stem);
      }
    }

    if (stemsToCheck.length === 0) continue;

    // Current gallery + parent thumb + all variation thumbs = IDs already accounted for
    const existingGalleryIds = product.currentGallery
      ? product.currentGallery.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
      : [];
    const existingSet = new Set([...existingGalleryIds, product.thumbAttachmentId]);
    varInfo.thumbIds.forEach(id => existingSet.add(id));

    // Find sequential attachments for each stem
    const candidateMap = new Map<number, { id: number; file: string; seq: number }>();

    for (const stem of stemsToCheck) {
      const attachments = await findSequentialAttachments(conn, stem);
      for (const att of attachments) {
        if (!existingSet.has(att.ID) && !candidateMap.has(att.ID)) {
          candidateMap.set(att.ID, {
            id: att.ID,
            file: att.meta_value,
            seq: extractSequenceNumber(att.meta_value),
          });
        } else if (existingSet.has(att.ID)) {
          alreadyInGallery++;
        }
      }
    }

    if (candidateMap.size === 0) continue;

    // Sort by sequence number
    const newImages = Array.from(candidateMap.values()).sort((a, b) => a.seq - b.seq);
    const newIds = newImages.map(img => img.id);

    parentsWithOrphans++;
    totalImagesRecovered += newIds.length;

    const updatedGallery = [...existingGalleryIds, ...newIds].join(',');

    if (options.dryRun) {
      console.log(`  [${product.parentId}] ${product.parentTitle} (${stemsToCheck.length} stems checked)`);
      console.log(`    Gallery: ${existingGalleryIds.length} → ${existingGalleryIds.length + newIds.length} (+${newIds.length})`);
      for (const img of newImages) {
        const basename = img.file.split('/').pop();
        console.log(`      + ${img.id}: ${basename}`);
      }
    } else {
      const result = await upsertGallery(conn, product.parentId, updatedGallery);
      if (result === 'updated') galleryRowsUpdated++;
      else galleryRowsCreated++;

      if (parentsWithOrphans <= 20 || options.productId) {
        console.log(`  [${product.parentId}] ${product.parentTitle} — +${newIds.length} images`);
      }
    }
  }

  if (!options.dryRun && parentsWithOrphans > 20 && !options.productId) {
    console.log(`  ... (${parentsWithOrphans} parents total)`);
  }

  console.log('\n' + '═'.repeat(55));
  console.log('  SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Parents scanned:              ${parentsScanned}`);
  console.log(`  Parents with orphaned images: ${parentsWithOrphans}`);
  console.log(`  Total images recovered:       ${totalImagesRecovered}`);
  console.log(`  Already in gallery (skipped): ${alreadyInGallery}`);
  if (!options.dryRun) {
    console.log(`  Gallery rows updated:         ${galleryRowsUpdated}`);
    console.log(`  Gallery rows created:         ${galleryRowsCreated}`);
  }
  console.log('═'.repeat(55));

  await conn.end();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
