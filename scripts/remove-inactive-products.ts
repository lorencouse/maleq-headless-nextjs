#!/usr/bin/env bun

/**
 * Remove Inactive Products and Variations
 *
 * Removes products/variations based on:
 * - A list of SKUs from a file (--sku-file)
 * - Products marked as inactive (_wt_active != '1') in WordPress
 *
 * Also removes associated:
 * - Featured images
 * - Gallery images
 * - All associated metadata
 *
 * Usage:
 *   bun scripts/remove-inactive-products.ts --sku-file inactive-skus.txt --dry-run
 *   bun scripts/remove-inactive-products.ts --sku-file inactive-skus.txt
 *   bun scripts/remove-inactive-products.ts --by-meta --dry-run
 *
 * Options:
 *   --sku-file <file>   File with SKUs to remove (one per line)
 *   --by-meta           Remove items where _wt_active != '1'
 *   --dry-run           Preview changes without deleting
 *   --variations-only   Only remove variations (keep parent products)
 *   --limit <n>         Limit number of items to process
 */

import { createConnection, Connection } from 'mysql2/promise';
import { unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

interface InactiveItem {
  id: number;
  title: string;
  type: 'product' | 'variation';
  parentId: number | null;
  sku: string | null;
  thumbnailId: number | null;
  galleryIds: number[];
}

interface ImageInfo {
  id: number;
  filePath: string;
  url: string;
}

interface ProcessOptions {
  dryRun: boolean;
  variationsOnly: boolean;
  limit?: number;
  skuFile?: string;
  byMeta: boolean;
}

const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';

function parseArgs(): ProcessOptions {
  const args = process.argv.slice(2);
  const options: ProcessOptions = {
    dryRun: false,
    variationsOnly: false,
    byMeta: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--variations-only') {
      options.variationsOnly = true;
    } else if (arg === '--by-meta') {
      options.byMeta = true;
    } else if (arg === '--sku-file' && i + 1 < args.length) {
      options.skuFile = args[i + 1];
      i++;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Remove Inactive Products and Variations

Removes products/variations based on SKU list or _wt_active meta field.

Usage:
  bun scripts/remove-inactive-products.ts --sku-file inactive-skus.txt --dry-run
  bun scripts/remove-inactive-products.ts --sku-file inactive-skus.txt
  bun scripts/remove-inactive-products.ts --by-meta --dry-run

Options:
  --sku-file <file>   File containing SKUs to remove (one per line)
  --by-meta           Remove items where _wt_active = '0'
  --dry-run           Preview changes without deleting anything
  --variations-only   Only remove variations (keep parent products)
  --limit <n>         Limit number of items to process
  --help, -h          Show this help message

Example SKU file format:
  819835021612
  819835021629
  ANOTHER-SKU-123
`);
      process.exit(0);
    }
  }

  return options;
}

async function getConnection(): Promise<Connection> {
  return createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'local',
    socketPath: '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock',
  });
}

async function loadSkusFromFile(filePath: string): Promise<Set<string>> {
  const content = await readFile(filePath, 'utf-8');
  const skus = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  return new Set(skus);
}

async function getInactiveItems(
  connection: Connection,
  options: ProcessOptions
): Promise<InactiveItem[]> {
  let query = `
    SELECT
      p.ID as id,
      p.post_title as title,
      p.post_type as postType,
      p.post_parent as parentId,
      pm_sku.meta_value as sku,
      pm_thumb.meta_value as thumbnailId,
      pm_gallery.meta_value as galleryIds,
      pm_active.meta_value as activeStatus
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm_sku ON p.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
    LEFT JOIN wp_postmeta pm_thumb ON p.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pm_gallery ON p.ID = pm_gallery.post_id AND pm_gallery.meta_key = '_product_image_gallery'
    LEFT JOIN wp_postmeta pm_active ON p.ID = pm_active.post_id AND pm_active.meta_key = '_wt_active'
    WHERE p.post_status != 'trash'
  `;

  if (options.variationsOnly) {
    query += ` AND p.post_type = 'product_variation'`;
  } else {
    query += ` AND p.post_type IN ('product', 'product_variation')`;
  }

  // Filter based on mode
  if (options.skuFile) {
    // Load SKUs from file and filter by them
    const skusToRemove = await loadSkusFromFile(options.skuFile);
    if (skusToRemove.size === 0) {
      console.log('No SKUs found in file');
      return [];
    }
    console.log(`Loaded ${skusToRemove.size} SKUs from file\n`);

    // We'll filter in JS since MySQL IN clause with many values can be slow
    query += ` AND pm_sku.meta_value IS NOT NULL`;
    query += ` ORDER BY p.post_type DESC, p.ID`;

    const [rows] = await connection.execute(query);

    return (rows as any[])
      .filter(row => row.sku && skusToRemove.has(row.sku))
      .slice(0, options.limit || Infinity)
      .map(row => ({
        id: row.id,
        title: row.title,
        type: row.postType === 'product_variation' ? 'variation' as const : 'product' as const,
        parentId: row.parentId || null,
        sku: row.sku || null,
        thumbnailId: row.thumbnailId ? parseInt(row.thumbnailId, 10) : null,
        galleryIds: row.galleryIds
          ? row.galleryIds.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => id > 0)
          : [],
      }));
  } else if (options.byMeta) {
    // Find by _wt_active meta
    query += ` AND (pm_active.meta_value = '0' OR pm_active.meta_value = 'false')`;
    query += ` ORDER BY p.post_type DESC, p.ID`;

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const [rows] = await connection.execute(query);

    return (rows as any[]).map(row => ({
      id: row.id,
      title: row.title,
      type: row.postType === 'product_variation' ? 'variation' as const : 'product' as const,
      parentId: row.parentId || null,
      sku: row.sku || null,
      thumbnailId: row.thumbnailId ? parseInt(row.thumbnailId, 10) : null,
      galleryIds: row.galleryIds
        ? row.galleryIds.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => id > 0)
        : [],
    }));
  } else {
    return [];
  }
}

async function getImageInfo(connection: Connection, imageId: number): Promise<ImageInfo | null> {
  const [rows] = await connection.execute(
    `SELECT ID, guid FROM wp_posts WHERE ID = ? AND post_type = 'attachment'`,
    [imageId]
  );

  const result = rows as any[];
  if (result.length === 0) return null;

  const url = result[0].guid;
  // Convert URL to file path
  // URL: http://maleq-local.local/wp-content/uploads/2026/01/file.webp
  // Path: /Users/.../wp-content/uploads/2026/01/file.webp
  const uploadPath = url.replace(/^https?:\/\/[^\/]+\/wp-content\/uploads\//, '');
  const filePath = join(WP_UPLOADS_DIR, uploadPath);

  return {
    id: imageId,
    filePath,
    url,
  };
}

async function getImageUsageCount(connection: Connection, imageId: number, excludePostId: number): Promise<number> {
  // Check if this image is used by any other product/post
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as count FROM wp_postmeta
     WHERE meta_value = ?
     AND meta_key IN ('_thumbnail_id', '_product_image_gallery')
     AND post_id != ?`,
    [imageId.toString(), excludePostId]
  );

  return (rows as any[])[0].count;
}

async function deleteImage(
  connection: Connection,
  imageId: number,
  dryRun: boolean
): Promise<{ deleted: boolean; reason: string }> {
  const imageInfo = await getImageInfo(connection, imageId);
  if (!imageInfo) {
    return { deleted: false, reason: 'Image not found in database' };
  }

  // Check if image is used elsewhere
  const usageCount = await getImageUsageCount(connection, imageId, 0);
  if (usageCount > 0) {
    return { deleted: false, reason: `Image used by ${usageCount} other posts` };
  }

  if (!dryRun) {
    // Delete from wp_postmeta (attachment metadata)
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ?`,
      [imageId]
    );

    // Delete from wp_posts
    await connection.execute(
      `DELETE FROM wp_posts WHERE ID = ?`,
      [imageId]
    );

    // Delete file from filesystem
    if (existsSync(imageInfo.filePath)) {
      try {
        await unlink(imageInfo.filePath);

        // Also try to delete resized versions (-150x150, -300x300, etc.)
        const basePath = imageInfo.filePath.replace(/\.[^.]+$/, '');
        const ext = imageInfo.filePath.split('.').pop();
        const sizes = ['150x150', '300x300', '768x768', '1024x1024', '100x100', '324x324', '416x416', '510x510'];
        for (const size of sizes) {
          const resizedPath = `${basePath}-${size}.${ext}`;
          if (existsSync(resizedPath)) {
            try {
              await unlink(resizedPath);
            } catch {
              // Ignore errors for resized images
            }
          }
        }
      } catch (error) {
        // File might not exist or permission issue
      }
    }
  }

  return { deleted: true, reason: 'Deleted' };
}

async function deleteProduct(
  connection: Connection,
  item: InactiveItem,
  dryRun: boolean
): Promise<{ imagesDeleted: number; imagesFailed: number }> {
  let imagesDeleted = 0;
  let imagesFailed = 0;

  // Collect all image IDs
  const imageIds: number[] = [];
  if (item.thumbnailId) imageIds.push(item.thumbnailId);
  imageIds.push(...item.galleryIds);

  // Delete images that aren't used elsewhere
  for (const imageId of imageIds) {
    const result = await deleteImage(connection, imageId, dryRun);
    if (result.deleted) {
      imagesDeleted++;
    } else {
      imagesFailed++;
    }
  }

  if (!dryRun) {
    // Delete from WooCommerce lookup tables
    await connection.execute(
      `DELETE FROM wp_wc_product_meta_lookup WHERE product_id = ?`,
      [item.id]
    );

    // Delete term relationships
    await connection.execute(
      `DELETE FROM wp_term_relationships WHERE object_id = ?`,
      [item.id]
    );

    // Delete postmeta
    await connection.execute(
      `DELETE FROM wp_postmeta WHERE post_id = ?`,
      [item.id]
    );

    // Delete the post
    await connection.execute(
      `DELETE FROM wp_posts WHERE ID = ?`,
      [item.id]
    );
  }

  return { imagesDeleted, imagesFailed };
}

async function updateParentAfterVariationDelete(
  connection: Connection,
  parentId: number,
  dryRun: boolean
): Promise<void> {
  // Check if parent has any remaining variations
  const [remaining] = await connection.execute(
    `SELECT COUNT(*) as count FROM wp_posts
     WHERE post_parent = ? AND post_type = 'product_variation' AND post_status != 'trash'`,
    [parentId]
  );

  const remainingCount = (remaining as any[])[0].count;

  if (remainingCount === 0) {
    // No variations left - could delete parent or convert to simple product
    console.log(`    ⚠️  Parent product ${parentId} has no remaining variations`);
  } else if (!dryRun) {
    // Update parent's price range based on remaining variations
    const [priceRows] = await connection.execute(
      `SELECT MIN(CAST(pm.meta_value AS DECIMAL(10,2))) as minPrice,
              MAX(CAST(pm.meta_value AS DECIMAL(10,2))) as maxPrice
       FROM wp_posts p
       JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_price'
       WHERE p.post_parent = ? AND p.post_type = 'product_variation' AND p.post_status = 'publish'`,
      [parentId]
    );

    const { minPrice, maxPrice } = (priceRows as any[])[0];
    if (minPrice !== null) {
      await connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
        [minPrice.toString(), parentId]
      );

      await connection.execute(
        `UPDATE wp_wc_product_meta_lookup SET min_price = ?, max_price = ? WHERE product_id = ?`,
        [minPrice, maxPrice, parentId]
      );
    }
  }
}

async function main() {
  const options = parseArgs();

  if (!options.skuFile && !options.byMeta) {
    console.error('Error: Please specify --sku-file <file> or --by-meta');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Remove Inactive Products and Variations');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  } else {
    console.log('⚠️  LIVE MODE - Items will be permanently deleted!\n');
  }

  if (options.skuFile) {
    console.log(`Mode: Remove by SKU file (${options.skuFile})\n`);
  } else {
    console.log('Mode: Remove by _wt_active meta field\n');
  }

  const connection = await getConnection();

  try {
    // Get inactive items
    console.log('Finding products and variations to remove...\n');
    const inactiveItems = await getInactiveItems(connection, options);

    if (inactiveItems.length === 0) {
      console.log('No inactive items found.');
      return;
    }

    console.log(`Found ${inactiveItems.length} inactive items:\n`);

    // Group by type for summary
    const variations = inactiveItems.filter(i => i.type === 'variation');
    const products = inactiveItems.filter(i => i.type === 'product');

    console.log(`  Variations: ${variations.length}`);
    console.log(`  Products: ${products.length}\n`);

    // Track affected parents
    const affectedParents = new Set<number>();

    // Process items
    let totalImagesDeleted = 0;
    let totalImagesFailed = 0;
    let processed = 0;

    for (const item of inactiveItems) {
      processed++;
      const typeIcon = item.type === 'variation' ? '📦' : '🛍️';
      console.log(`[${processed}/${inactiveItems.length}] ${typeIcon} ${item.title}`);
      console.log(`    ID: ${item.id} | SKU: ${item.sku || 'N/A'}`);

      if (item.type === 'variation' && item.parentId) {
        affectedParents.add(item.parentId);
      }

      const imageCount = (item.thumbnailId ? 1 : 0) + item.galleryIds.length;
      console.log(`    Images to check: ${imageCount}`);

      const result = await deleteProduct(connection, item, options.dryRun);
      totalImagesDeleted += result.imagesDeleted;
      totalImagesFailed += result.imagesFailed;

      console.log(`    ${options.dryRun ? 'Would delete' : 'Deleted'}: ${result.imagesDeleted} images`);
      if (result.imagesFailed > 0) {
        console.log(`    Skipped: ${result.imagesFailed} images (used elsewhere)`);
      }
      console.log('');
    }

    // Update affected parent products
    if (affectedParents.size > 0 && !options.variationsOnly) {
      console.log(`Updating ${affectedParents.size} affected parent products...\n`);
      for (const parentId of affectedParents) {
        await updateParentAfterVariationDelete(connection, parentId, options.dryRun);
      }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log(`  Items processed: ${processed}`);
    console.log(`    - Variations: ${variations.length}`);
    console.log(`    - Products: ${products.length}`);
    console.log(`  Images deleted: ${totalImagesDeleted}`);
    console.log(`  Images skipped (shared): ${totalImagesFailed}`);
    console.log(`  Parent products affected: ${affectedParents.size}`);
    if (options.dryRun) {
      console.log('\n  (Dry run - no actual changes made)');
    }
    console.log('='.repeat(60));

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
