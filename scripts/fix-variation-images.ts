#!/usr/bin/env bun

/**
 * Fix Variation Images
 *
 * Assigns unique images from the parent product's gallery to each variation.
 * This fixes products where all variations incorrectly share the same image.
 *
 * Logic:
 * 1. Get the parent product's featured image + gallery images
 * 2. Get all variations in menu_order
 * 3. Assign image N to variation N (featured=1, gallery[0]=2, etc.)
 *
 * Usage:
 *   bun scripts/fix-variation-images.ts --product-id <id>
 *   bun scripts/fix-variation-images.ts --slug <slug>
 *   bun scripts/fix-variation-images.ts --all          # Fix all variable products
 *   bun scripts/fix-variation-images.ts --dry-run      # Preview changes
 */

import { createConnection, Connection } from 'mysql2/promise';

interface ProductInfo {
  id: number;
  title: string;
  featuredImageId: number | null;
  galleryImageIds: number[];
}

interface VariationInfo {
  id: number;
  name: string;
  menuOrder: number;
  currentImageId: number | null;
  color: string | null;
}

interface ProcessOptions {
  productId?: number;
  slug?: string;
  all: boolean;
  dryRun: boolean;
  limit?: number;
}

function parseArgs(): ProcessOptions {
  const args = process.argv.slice(2);
  const options: ProcessOptions = {
    all: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--product-id' && i + 1 < args.length) {
      options.productId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--slug' && i + 1 < args.length) {
      options.slug = args[i + 1];
      i++;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Fix Variation Images

Assigns unique images from the parent product's gallery to each variation.

Usage:
  bun scripts/fix-variation-images.ts --product-id <id>
  bun scripts/fix-variation-images.ts --slug <slug>
  bun scripts/fix-variation-images.ts --all

Options:
  --product-id <id>  Process a specific product by database ID
  --slug <slug>      Process a specific product by slug
  --all              Process all variable products with mismatched variation images
  --dry-run          Preview changes without modifying database
  --limit <n>        Limit number of products to process (with --all)
  --help, -h         Show this help message

Examples:
  # Fix a specific product
  bun scripts/fix-variation-images.ts --slug lelo-gigi-3-app-controlled-g-spot-vibrator

  # Preview changes for all products
  bun scripts/fix-variation-images.ts --all --dry-run --limit 10
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

async function getProductBySlug(connection: Connection, slug: string): Promise<number | null> {
  const [rows] = await connection.execute(
    `SELECT ID FROM wp_posts WHERE post_name = ? AND post_type = 'product'`,
    [slug]
  );
  const result = rows as any[];
  return result.length > 0 ? result[0].ID : null;
}

async function getProductInfo(connection: Connection, productId: number): Promise<ProductInfo | null> {
  // Get product title
  const [productRows] = await connection.execute(
    `SELECT post_title FROM wp_posts WHERE ID = ?`,
    [productId]
  );
  const product = (productRows as any[])[0];
  if (!product) return null;

  // Get featured image
  const [thumbRows] = await connection.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
    [productId]
  );
  const featuredImageId = (thumbRows as any[])[0]?.meta_value
    ? parseInt((thumbRows as any[])[0].meta_value, 10)
    : null;

  // Get gallery images
  const [galleryRows] = await connection.execute(
    `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
    [productId]
  );
  const galleryStr = (galleryRows as any[])[0]?.meta_value || '';
  const galleryImageIds = galleryStr
    ? galleryStr.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => id > 0)
    : [];

  return {
    id: productId,
    title: product.post_title,
    featuredImageId,
    galleryImageIds,
  };
}

async function getVariations(connection: Connection, parentId: number): Promise<VariationInfo[]> {
  const [rows] = await connection.execute(
    `SELECT
      v.ID as id,
      v.post_title as name,
      v.menu_order as menuOrder,
      pm_thumb.meta_value as currentImageId,
      pm_color.meta_value as color
    FROM wp_posts v
    LEFT JOIN wp_postmeta pm_thumb ON v.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
    LEFT JOIN wp_postmeta pm_color ON v.ID = pm_color.post_id AND pm_color.meta_key = 'attribute_pa_color'
    WHERE v.post_parent = ?
      AND v.post_type = 'product_variation'
      AND v.post_status = 'publish'
    ORDER BY v.menu_order, v.ID`,
    [parentId]
  );

  return (rows as any[]).map(row => ({
    id: row.id,
    name: row.name,
    menuOrder: row.menuOrder || 0,
    currentImageId: row.currentImageId ? parseInt(row.currentImageId, 10) : null,
    color: row.color,
  }));
}

async function getImageUrl(connection: Connection, imageId: number): Promise<string> {
  const [rows] = await connection.execute(
    `SELECT guid FROM wp_posts WHERE ID = ?`,
    [imageId]
  );
  const result = rows as any[];
  if (result.length === 0) return `(ID: ${imageId})`;

  // Extract just the filename
  const url = result[0].guid;
  const filename = url.split('/').pop() || url;
  return filename;
}

async function updateVariationImage(
  connection: Connection,
  variationId: number,
  imageId: number
): Promise<void> {
  // Check if _thumbnail_id exists
  const [existing] = await connection.execute(
    `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
    [variationId]
  );

  if ((existing as any[]).length > 0) {
    // Update existing
    await connection.execute(
      `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
      [imageId.toString(), variationId]
    );
  } else {
    // Insert new
    await connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
      [variationId, imageId.toString()]
    );
  }
}

async function findProductsWithMismatchedImages(
  connection: Connection,
  limit?: number
): Promise<number[]> {
  // Find variable products where all variations have the same image
  // but the parent has multiple gallery images
  const query = `
    SELECT DISTINCT p.ID
    FROM wp_posts p
    INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
    INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    INNER JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE p.post_type = 'product'
      AND p.post_status = 'publish'
      AND tt.taxonomy = 'product_type'
      AND t.slug = 'variable'
      AND EXISTS (
        SELECT 1 FROM wp_postmeta pm
        WHERE pm.post_id = p.ID
        AND pm.meta_key = '_product_image_gallery'
        AND pm.meta_value != ''
        AND pm.meta_value IS NOT NULL
      )
    ORDER BY p.ID
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const [rows] = await connection.execute(query);
  return (rows as any[]).map(row => row.ID);
}

async function processProduct(
  connection: Connection,
  productId: number,
  dryRun: boolean
): Promise<{ fixed: boolean; changes: string[] }> {
  const changes: string[] = [];

  const product = await getProductInfo(connection, productId);
  if (!product) {
    return { fixed: false, changes: ['Product not found'] };
  }

  // Build list of all available images (featured + gallery)
  const allImages: number[] = [];
  if (product.featuredImageId) {
    allImages.push(product.featuredImageId);
  }
  allImages.push(...product.galleryImageIds);

  if (allImages.length === 0) {
    return { fixed: false, changes: ['No images available'] };
  }

  const variations = await getVariations(connection, productId);
  if (variations.length === 0) {
    return { fixed: false, changes: ['No variations found'] };
  }

  // Check if all variations have the same image (indicating the problem)
  const uniqueImages = new Set(variations.map(v => v.currentImageId).filter(Boolean));

  // If variations already have different images, check if they match available images
  if (uniqueImages.size === variations.length) {
    const allMatch = variations.every(v => allImages.includes(v.currentImageId!));
    if (allMatch) {
      return { fixed: false, changes: ['Variations already have unique, correct images'] };
    }
  }

  // Not enough images for all variations
  if (allImages.length < variations.length) {
    changes.push(`Warning: Only ${allImages.length} images for ${variations.length} variations`);
  }

  // Assign images to variations
  let fixed = false;
  for (let i = 0; i < variations.length; i++) {
    const variation = variations[i];
    const targetImageId = allImages[i % allImages.length]; // Cycle through images if not enough

    if (variation.currentImageId !== targetImageId) {
      const currentImg = variation.currentImageId
        ? await getImageUrl(connection, variation.currentImageId)
        : 'none';
      const targetImg = await getImageUrl(connection, targetImageId);

      changes.push(
        `  ${variation.color || variation.name}: ${currentImg} → ${targetImg}`
      );

      if (!dryRun) {
        await updateVariationImage(connection, variation.id, targetImageId);
      }
      fixed = true;
    }
  }

  if (!fixed) {
    changes.push('No changes needed');
  }

  return { fixed, changes };
}

async function main() {
  const options = parseArgs();

  if (!options.productId && !options.slug && !options.all) {
    console.error('Error: Please specify --product-id, --slug, or --all');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Fix Variation Images');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const connection = await getConnection();

  try {
    let productIds: number[] = [];

    if (options.slug) {
      const id = await getProductBySlug(connection, options.slug);
      if (!id) {
        console.error(`Product not found with slug: ${options.slug}`);
        process.exit(1);
      }
      productIds = [id];
    } else if (options.productId) {
      productIds = [options.productId];
    } else if (options.all) {
      console.log('Finding variable products with gallery images...');
      productIds = await findProductsWithMismatchedImages(connection, options.limit);
      console.log(`Found ${productIds.length} products to check\n`);
    }

    let processed = 0;
    let fixed = 0;

    for (const productId of productIds) {
      processed++;
      const product = await getProductInfo(connection, productId);

      if (product) {
        console.log(`[${processed}/${productIds.length}] ${product.title} (ID: ${productId})`);

        const result = await processProduct(connection, productId, options.dryRun);

        for (const change of result.changes) {
          console.log(change);
        }

        if (result.fixed) {
          fixed++;
        }
        console.log('');
      }
    }

    console.log('='.repeat(60));
    console.log('Summary:');
    console.log(`  Processed: ${processed}`);
    console.log(`  Fixed: ${fixed}`);
    if (options.dryRun) {
      console.log('  (Dry run - no actual changes made)');
    }
    console.log('='.repeat(60));

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
