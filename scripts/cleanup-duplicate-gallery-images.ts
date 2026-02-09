#!/usr/bin/env bun

/**
 * Cleanup Duplicate Gallery Images
 *
 * Finds and removes duplicate gallery images that have MD5 hash suffixes
 * (e.g. product-1-46b436a2.webp) when a non-hashed version already exists.
 *
 * Usage:
 *   bun scripts/cleanup-duplicate-gallery-images.ts --analyze
 *   bun scripts/cleanup-duplicate-gallery-images.ts --dry-run
 *   bun scripts/cleanup-duplicate-gallery-images.ts --apply
 *
 * Options:
 *   --analyze   Show analysis of duplicate images without changes
 *   --dry-run   Show what would be cleaned up without making changes
 *   --apply     Actually remove duplicates and update galleries
 *   --limit <n> Limit number of products to process
 */

import { createConnection, Connection } from 'mysql2/promise';
import { existsSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';
const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';

// Match hash-suffixed filenames: name-[8 hex chars].webp
const HASH_PATTERN = /-[a-f0-9]{8}\.webp$/;

interface DuplicateInfo {
  productId: number;
  productName: string;
  galleryIds: number[];
  duplicates: Array<{
    attachmentId: number;
    filename: string;
    originalFilename: string;
    originalAttachmentId: number | null;
    filePath: string;
  }>;
}

type Mode = 'analyze' | 'dry-run' | 'apply';

function parseArgs(): { mode: Mode; limit?: number } {
  const args = process.argv.slice(2);
  let mode: Mode = 'analyze';
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--analyze') mode = 'analyze';
    else if (args[i] === '--dry-run') mode = 'dry-run';
    else if (args[i] === '--apply') mode = 'apply';
    else if (args[i] === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Cleanup Duplicate Gallery Images

Usage:
  bun scripts/cleanup-duplicate-gallery-images.ts [mode] [options]

Modes:
  --analyze   Show analysis of duplicate images (default)
  --dry-run   Show what would be cleaned up
  --apply     Remove duplicates and update galleries

Options:
  --limit <n> Limit number of products to process
  --help, -h  Show this help message
      `);
      process.exit(0);
    }
  }

  return { mode, limit };
}

async function findDuplicates(connection: Connection, limit?: number): Promise<DuplicateInfo[]> {
  // Get all products with gallery images
  let query = `
    SELECT
      p.ID as productId,
      p.post_title as productName,
      gallery.meta_value as galleryIds
    FROM wp_posts p
    INNER JOIN wp_postmeta gallery ON p.ID = gallery.post_id AND gallery.meta_key = '_product_image_gallery'
    WHERE p.post_type = 'product'
      AND p.post_status = 'publish'
      AND gallery.meta_value != ''
    ORDER BY p.ID ASC
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const [rows] = await connection.execute(query);
  const products = rows as any[];

  const duplicates: DuplicateInfo[] = [];

  for (const product of products) {
    const galleryIds = product.galleryIds.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));

    if (galleryIds.length === 0) continue;

    // Get attachment info for all gallery IDs
    const placeholders = galleryIds.map(() => '?').join(',');
    const [attachments] = await connection.execute(
      `SELECT
        p.ID,
        p.guid,
        m.meta_value as attached_file
      FROM wp_posts p
      LEFT JOIN wp_postmeta m ON p.ID = m.post_id AND m.meta_key = '_wp_attached_file'
      WHERE p.ID IN (${placeholders})`,
      galleryIds
    );

    const attachmentMap = new Map<number, { guid: string; file: string; filename: string }>();
    for (const att of attachments as any[]) {
      const filename = basename(att.attached_file || att.guid);
      attachmentMap.set(att.ID, { guid: att.guid, file: att.attached_file || '', filename });
    }

    // Find hash-suffixed duplicates
    const productDuplicates: DuplicateInfo['duplicates'] = [];

    for (const id of galleryIds) {
      const att = attachmentMap.get(id);
      if (!att) continue;

      if (HASH_PATTERN.test(att.filename)) {
        // This is a hash-suffixed file — find the original
        const originalFilename = att.filename.replace(/-[a-f0-9]{8}\.webp$/, '.webp');

        // Check if the original exists as another attachment in this gallery
        let originalAttachmentId: number | null = null;
        for (const [otherId, otherAtt] of attachmentMap) {
          if (otherId !== id && otherAtt.filename === originalFilename) {
            originalAttachmentId = otherId;
            break;
          }
        }

        // Also check DB for original attachment even if not in this gallery
        if (originalAttachmentId === null) {
          const [origRows] = await connection.execute(
            `SELECT ID FROM wp_posts WHERE post_type = 'attachment' AND guid LIKE ?`,
            [`%/${originalFilename}`]
          );
          if ((origRows as any[]).length > 0) {
            originalAttachmentId = (origRows as any[])[0].ID;
          }
        }

        const filePath = att.file ? join(WP_UPLOADS_DIR, att.file) : '';

        productDuplicates.push({
          attachmentId: id,
          filename: att.filename,
          originalFilename,
          originalAttachmentId,
          filePath,
        });
      }
    }

    if (productDuplicates.length > 0) {
      duplicates.push({
        productId: product.productId,
        productName: product.productName,
        galleryIds,
        duplicates: productDuplicates,
      });
    }
  }

  return duplicates;
}

async function cleanupDuplicates(connection: Connection, duplicates: DuplicateInfo[], mode: Mode): Promise<void> {
  let totalRemoved = 0;
  let totalFilesDeleted = 0;
  let totalGalleriesUpdated = 0;

  for (const product of duplicates) {
    console.log(`\n[Product #${product.productId}] ${product.productName.substring(0, 60)}`);
    console.log(`  Gallery IDs: ${product.galleryIds.join(', ')}`);

    const idsToRemove = new Set<number>();

    for (const dup of product.duplicates) {
      console.log(`  Duplicate: ${dup.filename} (ID: ${dup.attachmentId})`);
      console.log(`    Original: ${dup.originalFilename} (ID: ${dup.originalAttachmentId ?? 'not found'})`);

      if (dup.originalAttachmentId) {
        idsToRemove.add(dup.attachmentId);
      } else {
        console.log(`    ⚠ No original found — keeping duplicate`);
      }
    }

    if (idsToRemove.size === 0) continue;

    // Update gallery to remove duplicate IDs
    const newGalleryIds = product.galleryIds.filter(id => !idsToRemove.has(id));
    const newGalleryValue = newGalleryIds.join(',');

    console.log(`  Updated gallery: ${newGalleryValue}`);

    if (mode === 'apply') {
      // Update gallery meta
      await connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
        [newGalleryValue, product.productId]
      );
      totalGalleriesUpdated++;

      // Delete duplicate attachments and their files
      for (const dup of product.duplicates) {
        if (!idsToRemove.has(dup.attachmentId)) continue;

        // Delete attachment post
        await connection.execute(`DELETE FROM wp_posts WHERE ID = ?`, [dup.attachmentId]);
        // Delete attachment meta
        await connection.execute(`DELETE FROM wp_postmeta WHERE post_id = ?`, [dup.attachmentId]);

        // Delete file from disk
        if (dup.filePath && existsSync(dup.filePath)) {
          try {
            unlinkSync(dup.filePath);
            totalFilesDeleted++;
            console.log(`  ✓ Deleted file: ${dup.filename}`);
          } catch (e) {
            console.log(`  ⚠ Could not delete file: ${dup.filename}`);
          }
        }

        totalRemoved++;
      }
    } else {
      totalRemoved += idsToRemove.size;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Products with duplicates: ${duplicates.length}`);
  console.log(`Duplicate attachments ${mode === 'apply' ? 'removed' : 'found'}: ${totalRemoved}`);
  if (mode === 'apply') {
    console.log(`Files deleted from disk: ${totalFilesDeleted}`);
    console.log(`Galleries updated: ${totalGalleriesUpdated}`);
  }
}

async function main() {
  const { mode, limit } = parseArgs();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Cleanup Duplicate Gallery Images         ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Mode: ${mode}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log();

  const connection = await createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('✓ Connected to database\n');

  try {
    console.log('Scanning for duplicate gallery images...');
    const duplicates = await findDuplicates(connection, limit);

    if (duplicates.length === 0) {
      console.log('✓ No duplicate gallery images found!');
      return;
    }

    console.log(`Found ${duplicates.length} products with hash-suffixed duplicates`);
    const totalDuplicates = duplicates.reduce((sum, d) => sum + d.duplicates.length, 0);
    console.log(`Total duplicate attachments: ${totalDuplicates}`);

    if (mode === 'analyze') {
      // Just show the analysis
      for (const product of duplicates) {
        console.log(`\n[#${product.productId}] ${product.productName.substring(0, 60)} — ${product.duplicates.length} duplicate(s)`);
        for (const dup of product.duplicates) {
          console.log(`  ${dup.filename} → original: ${dup.originalFilename} (ID: ${dup.originalAttachmentId ?? 'missing'})`);
        }
      }
    } else {
      await cleanupDuplicates(connection, duplicates, mode);
    }
  } finally {
    await connection.end();
  }

  console.log('\n✓ Done');
}

main().catch(error => {
  console.error('\n✗ Failed:', error);
  process.exit(1);
});
