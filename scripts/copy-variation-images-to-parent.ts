#!/usr/bin/env bun

/**
 * Copy Variation Images to Parent Products
 *
 * For variable products missing images:
 * 1. Get the first/primary variation's images
 * 2. Set first image as parent's featured image
 * 3. Set remaining images as parent's gallery
 *
 * Note: Only copies from the PRIMARY variation to avoid mixing
 * images from different variations (e.g., different colors).
 * When a user selects a different variation, that variation's
 * image will be shown via the variation selector.
 *
 * Usage:
 *   bun scripts/copy-variation-images-to-parent.ts [options]
 *
 * Options:
 *   --limit <n>       Limit number of products to process
 *   --dry-run         Show what would be done without making changes
 *   --product-id <id> Process a specific parent product by ID
 */

import { createConnection, Connection } from 'mysql2/promise';

interface ParentProduct {
  id: number;
  title: string;
  sku: string;
}

interface Variation {
  id: number;
  thumbnailId: number | null;
  galleryIds: number[];
  menuOrder: number;
}

interface ProcessOptions {
  limit?: number;
  dryRun: boolean;
  productId?: number;
  force: boolean;
}

function parseArgs(): ProcessOptions {
  const args = process.argv.slice(2);
  const options: ProcessOptions = {
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--product-id' && i + 1 < args.length) {
      options.productId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Copy Variation Images to Parent Products

Usage:
  bun scripts/copy-variation-images-to-parent.ts [options]

Options:
  --limit <n>       Limit number of products to process
  --dry-run         Show what would be done without making changes
  --force           Re-process products that already have images
  --product-id <id> Process a specific parent product by ID
  --help, -h        Show this help message
`);
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('Copy Variation Images to Parent Products');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const connection = await createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'local',
    socketPath: '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock',
  });

  try {
    // Find parent products missing images but with variations that have images
    const parents = await getParentsMissingImages(connection, options);
    console.log(`Found ${parents.length} parent products to process\n`);

    let processed = 0;
    let updated = 0;
    let skipped = 0;

    for (const parent of parents) {
      processed++;
      console.log(`[${processed}/${parents.length}] ${parent.title} (ID: ${parent.id})`);

      // Get all variations with their images
      const variations = await getVariationsWithImages(connection, parent.id);

      if (variations.length === 0) {
        console.log('  ⚠️  No variations with images found, skipping');
        skipped++;
        continue;
      }

      // Sort by menu_order to get primary variation first
      variations.sort((a, b) => a.menuOrder - b.menuOrder);

      // Count total images across ALL variations
      let totalVariationImages = 0;
      for (const v of variations) {
        if (v.thumbnailId) totalVariationImages++;
        totalVariationImages += v.galleryIds.length;
      }

      // Collect images - start with primary variation
      const allImageIds: number[] = [];
      const seenIds = new Set<number>();

      const primaryVariation = variations[0];
      if (primaryVariation.thumbnailId) {
        allImageIds.push(primaryVariation.thumbnailId);
        seenIds.add(primaryVariation.thumbnailId);
      }
      for (const imgId of primaryVariation.galleryIds) {
        if (!seenIds.has(imgId)) {
          allImageIds.push(imgId);
          seenIds.add(imgId);
        }
      }

      // If total images across all variations < 7, add images from other variations
      if (totalVariationImages < 7) {
        for (let i = 1; i < variations.length; i++) {
          const variation = variations[i];
          if (variation.thumbnailId && !seenIds.has(variation.thumbnailId)) {
            allImageIds.push(variation.thumbnailId);
            seenIds.add(variation.thumbnailId);
          }
          for (const imgId of variation.galleryIds) {
            if (!seenIds.has(imgId)) {
              allImageIds.push(imgId);
              seenIds.add(imgId);
            }
          }
        }
      }

      if (allImageIds.length === 0) {
        console.log('  ⚠️  No images collected, skipping');
        skipped++;
        continue;
      }

      const thumbnailId = allImageIds[0];
      const galleryIds = allImageIds.slice(1);

      console.log(`  📷 Setting thumbnail: ${thumbnailId}`);
      console.log(`  🖼️  Setting gallery: ${galleryIds.length} images`);

      if (!options.dryRun) {
        await setParentImages(connection, parent.id, thumbnailId, galleryIds);
      }

      updated++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log(`  Processed: ${processed}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log('='.repeat(60));

  } finally {
    await connection.end();
  }
}

async function getParentsMissingImages(
  connection: Connection,
  options: ProcessOptions
): Promise<ParentProduct[]> {
  let query = `
    SELECT DISTINCT
      parent.ID as id,
      parent.post_title as title,
      COALESCE(pm_sku.meta_value, '') as sku
    FROM wp_posts parent
    LEFT JOIN wp_postmeta pm_sku ON parent.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
    LEFT JOIN wp_postmeta pm_thumb ON parent.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    INNER JOIN wp_posts var ON var.post_parent = parent.ID AND var.post_type = 'product_variation'
    INNER JOIN wp_postmeta pm_var_thumb ON var.ID = pm_var_thumb.post_id
      AND pm_var_thumb.meta_key = '_thumbnail_id'
      AND pm_var_thumb.meta_value IS NOT NULL
      AND pm_var_thumb.meta_value != ''
      AND pm_var_thumb.meta_value != '0'
    WHERE parent.post_type = 'product'
      AND parent.post_status = 'publish'
  `;

  // Only filter for missing images if not forcing
  if (!options.force) {
    query += ` AND (pm_thumb.meta_value IS NULL OR pm_thumb.meta_value = '' OR pm_thumb.meta_value = '0')`;
  }

  const params: any[] = [];

  if (options.productId) {
    query += ' AND parent.ID = ?';
    params.push(options.productId);
  }

  query += ' ORDER BY parent.ID';

  if (options.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  const [rows] = await connection.execute(query, params);
  return (rows as any[]).map(row => ({
    id: row.id,
    title: row.title,
    sku: row.sku,
  }));
}

async function getVariationsWithImages(
  connection: Connection,
  parentId: number
): Promise<Variation[]> {
  const query = `
    SELECT
      var.ID as id,
      var.menu_order as menuOrder,
      pm_thumb.meta_value as thumbnailId,
      pm_gallery.meta_value as galleryIds
    FROM wp_posts var
    LEFT JOIN wp_postmeta pm_thumb ON var.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pm_gallery ON var.ID = pm_gallery.post_id AND pm_gallery.meta_key = '_product_image_gallery'
    WHERE var.post_parent = ?
      AND var.post_type = 'product_variation'
      AND var.post_status = 'publish'
    ORDER BY var.menu_order, var.ID
  `;

  const [rows] = await connection.execute(query, [parentId]);

  return (rows as any[]).map(row => {
    const thumbnailId = row.thumbnailId ? parseInt(row.thumbnailId, 10) : null;
    const galleryIds = row.galleryIds
      ? row.galleryIds.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id) && id > 0)
      : [];

    return {
      id: row.id,
      thumbnailId: thumbnailId && thumbnailId > 0 ? thumbnailId : null,
      galleryIds,
      menuOrder: row.menuOrder || 0,
    };
  }).filter(v => v.thumbnailId || v.galleryIds.length > 0);
}

async function setParentImages(
  connection: Connection,
  parentId: number,
  thumbnailId: number,
  galleryIds: number[]
): Promise<void> {
  // Delete existing thumbnail and gallery entries first
  await connection.execute(
    `DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('_thumbnail_id', '_product_image_gallery')`,
    [parentId]
  );

  // Set thumbnail
  await connection.execute(
    `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
    [parentId, thumbnailId.toString()]
  );

  // Set gallery if there are images
  if (galleryIds.length > 0) {
    const galleryValue = galleryIds.join(',');
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
      [parentId, galleryValue]
    );
  }
}

main().catch(console.error);
