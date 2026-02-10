/**
 * Set category thumbnail images from product galleries.
 *
 * For each product category that lacks a thumbnail_id in wp_termmeta,
 * finds a product in that category and uses its featured image.
 * Prefers products from "XR Brands" brand.
 *
 * Usage:
 *   bun run scripts/set-category-images.ts --analyze     # Show which categories need images
 *   bun run scripts/set-category-images.ts --dry-run     # Show what would be set
 *   bun run scripts/set-category-images.ts --apply       # Apply changes
 */
import { getConnection } from './lib/db';

interface CategoryRow {
  term_id: number;
  name: string;
  slug: string;
  count: number;
  thumbnail_id: number | null;
}

interface ProductImageRow {
  product_id: number;
  product_title: string;
  thumbnail_id: number;
  is_xr_brands: number;
}

async function main() {
  const mode = process.argv[2] || '--analyze';
  if (!['--analyze', '--dry-run', '--apply'].includes(mode)) {
    console.log('Usage: bun run scripts/set-category-images.ts [--analyze|--dry-run|--apply]');
    process.exit(1);
  }

  const db = await getConnection();

  try {
    // 1. Get all product categories with their current thumbnail_id
    const [categories] = await db.query<CategoryRow[]>(`
      SELECT
        t.term_id,
        t.name,
        t.slug,
        tt.count,
        (SELECT tm.meta_value FROM wp_termmeta tm
         WHERE tm.term_id = t.term_id AND tm.meta_key = 'thumbnail_id'
         LIMIT 1) as thumbnail_id
      FROM wp_terms t
      JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
      WHERE tt.taxonomy = 'product_cat'
        AND tt.count > 0
      ORDER BY tt.count DESC
    `);

    console.log(`\nFound ${categories.length} product categories with products.\n`);

    // Separate categories by whether they have thumbnails
    const withThumbnail = categories.filter(c => c.thumbnail_id && Number(c.thumbnail_id) > 0);
    const withoutThumbnail = categories.filter(c => !c.thumbnail_id || Number(c.thumbnail_id) === 0);

    console.log(`  ${withThumbnail.length} already have thumbnails`);
    console.log(`  ${withoutThumbnail.length} need thumbnails\n`);

    if (mode === '--analyze') {
      console.log('Categories needing thumbnails:');
      for (const cat of withoutThumbnail) {
        console.log(`  - ${cat.name} (${cat.slug}) [${cat.count} products]`);
      }
      console.log(`\nRun with --dry-run to preview changes, or --apply to set thumbnails.`);
      await db.end();
      return;
    }

    // 2. For each category without a thumbnail, find a product image
    // Get the XR Brands term_id for preference matching
    const [xrBrandsRows] = await db.query<Array<{ term_id: number }>>(`
      SELECT t.term_id FROM wp_terms t
      JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
      WHERE tt.taxonomy = 'product_brand' AND t.slug = 'xr-brands'
      LIMIT 1
    `);
    const xrBrandsTermId = xrBrandsRows[0]?.term_id;
    console.log(xrBrandsTermId
      ? `XR Brands term_id: ${xrBrandsTermId}`
      : 'XR Brands brand not found - will use any product image');

    let updated = 0;
    let skipped = 0;

    for (const cat of withoutThumbnail) {
      // Find a product in this category with a featured image
      // Prefer XR Brands products, then any product with a featured image
      const [products] = await db.query<ProductImageRow[]>(`
        SELECT
          p.ID as product_id,
          p.post_title as product_title,
          CAST(pm.meta_value AS UNSIGNED) as thumbnail_id,
          CASE WHEN xr.object_id IS NOT NULL THEN 1 ELSE 0 END as is_xr_brands
        FROM wp_posts p
        JOIN wp_term_relationships tr ON tr.object_id = p.ID
        JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_thumbnail_id'
        LEFT JOIN wp_term_relationships xr ON xr.object_id = p.ID
          AND xr.term_taxonomy_id = (
            SELECT tt2.term_taxonomy_id FROM wp_term_taxonomy tt2
            WHERE tt2.term_id = ? AND tt2.taxonomy = 'product_brand'
            LIMIT 1
          )
        WHERE tr.term_taxonomy_id = (
          SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt
          WHERE tt.term_id = ? AND tt.taxonomy = 'product_cat'
          LIMIT 1
        )
        AND p.post_type = 'product'
        AND p.post_status = 'publish'
        AND pm.meta_value IS NOT NULL
        AND pm.meta_value != ''
        AND pm.meta_value != '0'
        ORDER BY is_xr_brands DESC, p.ID ASC
        LIMIT 1
      `, [xrBrandsTermId || 0, cat.term_id]);

      if (products.length === 0) {
        console.log(`  SKIP: ${cat.name} (${cat.slug}) - no products with featured images`);
        skipped++;
        continue;
      }

      const product = products[0];
      const source = product.is_xr_brands ? ' [XR Brands]' : '';

      if (mode === '--dry-run') {
        console.log(`  SET: ${cat.name} (${cat.slug}) <- "${product.product_title}" (ID:${product.product_id}, thumb:${product.thumbnail_id})${source}`);
      } else {
        // Check if termmeta row exists
        const [existing] = await db.query<Array<{ meta_id: number }>>(`
          SELECT meta_id FROM wp_termmeta
          WHERE term_id = ? AND meta_key = 'thumbnail_id'
          LIMIT 1
        `, [cat.term_id]);

        if (existing.length > 0) {
          await db.query(`
            UPDATE wp_termmeta SET meta_value = ? WHERE term_id = ? AND meta_key = 'thumbnail_id'
          `, [product.thumbnail_id.toString(), cat.term_id]);
        } else {
          await db.query(`
            INSERT INTO wp_termmeta (term_id, meta_key, meta_value) VALUES (?, 'thumbnail_id', ?)
          `, [cat.term_id, product.thumbnail_id.toString()]);
        }
        console.log(`  SET: ${cat.name} (${cat.slug}) <- "${product.product_title}" (thumb:${product.thumbnail_id})${source}`);
      }
      updated++;
    }

    console.log(`\n${mode === '--dry-run' ? 'Would update' : 'Updated'}: ${updated} categories`);
    console.log(`Skipped: ${skipped} categories (no product images found)`);
  } finally {
    await db.end();
  }
}

main().catch(console.error);
