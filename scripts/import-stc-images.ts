#!/usr/bin/env bun

/**
 * STC Image Import Script (Direct SQL)
 *
 * Imports images for existing STC products that were imported without images.
 * Uses direct MySQL and file system access (no REST API).
 * Follows same approach as import-images.ts but uses STC CSV as image source.
 *
 * Usage:
 *   bun scripts/import-stc-images.ts [options]
 *
 * Options:
 *   --limit <n>    Limit number of products to process (default: all)
 *   --dry-run      Show what would be imported without making changes
 *   --skip-existing Skip products that already have images
 */

import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { createConnection, Connection } from 'mysql2/promise';
import { STCCSVParser, type STCProduct } from '../lib/import/stc-csv-parser';
import { ImageProcessor } from '../lib/import/image-processor';

// Local by Flywheel MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// WordPress uploads directory
const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const WP_SITE_URL = 'http://maleq-local.local';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
}

interface ImportStats {
  processed: number;
  imagesUploaded: number;
  productsUpdated: number;
  skippedExisting: number;
  skippedNoImages: number;
  skippedNoMatch: number;
  errors: Array<{ sku: string; message: string }>;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    skipExisting: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
STC Image Import Script (Direct SQL)

Usage:
  bun scripts/import-stc-images.ts [options]

Options:
  --limit <n>      Limit number of products to process (default: all)
  --dry-run        Show what would be processed without downloading
  --skip-existing  Skip products that already have images
  --help, -h       Show this help message

Examples:
  bun scripts/import-stc-images.ts --limit 50
  bun scripts/import-stc-images.ts --dry-run --limit 10
  bun scripts/import-stc-images.ts --skip-existing
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * STC Image Importer with direct MySQL (based on import-images.ts pattern)
 */
class STCImageImporter {
  private connection: Connection;
  private imageProcessor: ImageProcessor;
  private options: ImportOptions;
  private stats: ImportStats = {
    processed: 0,
    imagesUploaded: 0,
    productsUpdated: 0,
    skippedExisting: 0,
    skippedNoImages: 0,
    skippedNoMatch: 0,
    errors: [],
  };

  constructor(connection: Connection, options: ImportOptions) {
    this.connection = connection;
    this.options = options;
    this.imageProcessor = new ImageProcessor(join(process.cwd(), 'data', 'stc-image-cache'));
  }

  async init(): Promise<void> {
    await this.imageProcessor.init();
  }

  /**
   * Get all STC products that need images
   */
  async getSTCProductsNeedingImages(): Promise<Array<{ postId: number; sku: string; name: string; hasImage: boolean }>> {
    // Query STC products and variations with numeric SKUs (UPCs from CSV)
    // Exclude variable parent products with generated SKUs (STC-VAR-...)
    let query = `
      SELECT
        p.ID as postId,
        COALESCE(parent.post_title, p.post_title) as name,
        sku.meta_value as sku,
        thumb.meta_value as thumbnail_id
      FROM wp_posts p
      INNER JOIN wp_postmeta sku ON p.ID = sku.post_id AND sku.meta_key = '_sku'
      LEFT JOIN wp_posts parent ON p.post_parent = parent.ID
      LEFT JOIN wp_postmeta thumb ON p.ID = thumb.post_id AND thumb.meta_key = '_thumbnail_id'
      WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status = 'publish'
        AND sku.meta_value REGEXP '^[0-9]+$'
        AND (
          EXISTS (SELECT 1 FROM wp_postmeta source WHERE source.post_id = p.ID AND source.meta_key = '_product_source' AND source.meta_value LIKE '%stc%')
          OR EXISTS (SELECT 1 FROM wp_postmeta stcupc WHERE stcupc.post_id = p.ID AND stcupc.meta_key = '_stc_upc')
        )
    `;

    if (this.options.skipExisting) {
      query += ` AND (thumb.meta_value IS NULL OR thumb.meta_value = '' OR thumb.meta_value = '0')`;
    }

    query += ` ORDER BY p.ID ASC`;

    const [rows] = await this.connection.execute(query);

    return (rows as any[]).map(row => ({
      postId: row.postId,
      sku: row.sku,
      name: row.name || '',
      hasImage: row.thumbnail_id && parseInt(row.thumbnail_id) > 0,
    }));
  }

  /**
   * Get WordPress uploads subdirectory for current month
   */
  getUploadsSubdir(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}/${month}`;
  }

  /**
   * Create WordPress attachment from processed image
   */
  async createAttachment(
    imagePath: string,
    filename: string,
    productName: string,
    index: number
  ): Promise<number | null> {
    try {
      const subdir = this.getUploadsSubdir();
      const uploadDir = join(WP_UPLOADS_DIR, subdir);

      // Ensure directory exists
      mkdirSync(uploadDir, { recursive: true });

      // Read processed image
      const imageBuffer = readFileSync(imagePath);

      // Check if an attachment with this filename already exists in the DB
      let finalFilename = filename;
      let filePath = join(uploadDir, finalFilename);

      if (existsSync(filePath)) {
        // Reuse existing attachment if one exists for this exact filename
        const [existingAttachment] = await this.connection.execute(
          `SELECT ID FROM wp_posts WHERE post_type = 'attachment' AND guid LIKE ?`,
          [`%/${filename}`]
        );
        if ((existingAttachment as any[]).length > 0) {
          return (existingAttachment as any[])[0].ID;
        }

        // No existing attachment found — add hash suffix to avoid file collision
        const hash = createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
        finalFilename = filename.replace('.webp', `-${hash}.webp`);
        filePath = join(uploadDir, finalFilename);
      }

      // Write file to uploads
      writeFileSync(filePath, imageBuffer);

      // Create WordPress attachment
      const altText = `${productName} - Image ${index}`;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const guid = `${WP_SITE_URL}/wp-content/uploads/${subdir}/${finalFilename}`;

      // Insert attachment post
      const [result] = await this.connection.execute(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type
        ) VALUES (1, ?, ?, '', ?, '', 'inherit', 'open', 'closed', '', ?, '', '', ?, ?, '', 0, ?, 0, 'attachment', 'image/webp')`,
        [now, now, altText, finalFilename.replace('.webp', ''), now, now, guid]
      );

      const attachmentId = (result as any).insertId;

      // Add attachment metadata
      const attachedFile = `${subdir}/${finalFilename}`;
      const metadata = this.generateAttachmentMetadata(imageBuffer, attachedFile);

      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES
          (?, '_wp_attached_file', ?),
          (?, '_wp_attachment_metadata', ?),
          (?, '_wp_attachment_image_alt', ?)`,
        [
          attachmentId, attachedFile,
          attachmentId, this.phpSerialize(metadata),
          attachmentId, altText,
        ]
      );

      this.stats.imagesUploaded++;
      return attachmentId;
    } catch (error) {
      console.error(`  ✗ Failed to create attachment: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  /**
   * Generate WordPress attachment metadata
   */
  generateAttachmentMetadata(imageBuffer: Buffer, attachedFile: string): object {
    return {
      width: 650,
      height: 650,
      file: attachedFile,
      filesize: imageBuffer.length,
      sizes: {},
      image_meta: {
        aperture: '0',
        credit: '',
        camera: '',
        caption: '',
        created_timestamp: '0',
        copyright: '',
        focal_length: '0',
        iso: '0',
        shutter_speed: '0',
        title: '',
        orientation: '1',
        keywords: [],
      },
    };
  }

  /**
   * Simple PHP serialize for metadata
   */
  phpSerialize(obj: any): string {
    if (obj === null) return 'N;';
    if (typeof obj === 'boolean') return `b:${obj ? 1 : 0};`;
    if (typeof obj === 'number') {
      if (Number.isInteger(obj)) return `i:${obj};`;
      return `d:${obj};`;
    }
    if (typeof obj === 'string') return `s:${obj.length}:"${obj}";`;
    if (Array.isArray(obj)) {
      const items = obj.map((v, i) => `${this.phpSerialize(i)}${this.phpSerialize(v)}`).join('');
      return `a:${obj.length}:{${items}}`;
    }
    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      const items = entries.map(([k, v]) => `${this.phpSerialize(k)}${this.phpSerialize(v)}`).join('');
      return `a:${entries.length}:{${items}}`;
    }
    return 'N;';
  }

  /**
   * Set product featured image
   */
  async setFeaturedImage(productId: number, attachmentId: number): Promise<void> {
    const [existing] = await this.connection.execute(
      `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
      [productId]
    );

    if ((existing as any[]).length > 0) {
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_thumbnail_id'`,
        [attachmentId.toString(), productId]
      );
    } else {
      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
        [productId, attachmentId.toString()]
      );
    }
  }

  /**
   * Set product gallery images
   */
  async setGalleryImages(productId: number, attachmentIds: number[]): Promise<void> {
    if (attachmentIds.length === 0) return;

    const galleryValue = attachmentIds.join(',');

    const [existing] = await this.connection.execute(
      `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
      [productId]
    );

    if ((existing as any[]).length > 0) {
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
        [galleryValue, productId]
      );
    } else {
      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
        [productId, galleryValue]
      );
    }
  }

  /**
   * Process images for a single product
   */
  async processProductImages(
    csvProduct: STCProduct,
    postId: number,
    productName: string
  ): Promise<boolean> {
    if (csvProduct.images.length === 0) {
      return false;
    }

    if (this.options.dryRun) {
      console.log(`  [DRY RUN] Would download ${csvProduct.images.length} image(s)`);
      return true;
    }

    try {
      // Process images using ImageProcessor (handles download, resize, webp conversion)
      // STC images are full URLs from Shopify CDN
      const processedImages = await this.imageProcessor.processProductImages(
        csvProduct.images,
        productName,
        '' // Empty base URL since STC images are full URLs
      );

      if (processedImages.length === 0) {
        console.log(`  ⚠ No images were successfully processed`);
        return false;
      }

      // Create attachments for processed images
      const attachmentIds: number[] = [];

      for (let i = 0; i < processedImages.length; i++) {
        const processed = processedImages[i];
        const attachmentId = await this.createAttachment(
          processed.localPath,
          processed.filename,
          productName,
          i + 1
        );

        if (attachmentId) {
          attachmentIds.push(attachmentId);
        }
      }

      if (attachmentIds.length === 0) {
        console.log(`  ⚠ No attachments were created`);
        return false;
      }

      // Set featured image
      await this.setFeaturedImage(postId, attachmentIds[0]);

      // Set gallery images (remaining)
      if (attachmentIds.length > 1) {
        await this.setGalleryImages(postId, attachmentIds.slice(1));
      }

      console.log(`  ✓ Added ${attachmentIds.length} image(s)`);
      return true;
    } catch (error) {
      console.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Import images for all STC products
   */
  async importImages(csvProducts: Map<string, STCProduct>): Promise<ImportStats> {
    // Get all STC products from database
    console.log('Fetching STC products from database...');
    const dbProducts = await this.getSTCProductsNeedingImages();
    console.log(`Found ${dbProducts.length} STC products in database\n`);

    // Apply limit if specified
    const toProcess = this.options.limit ? dbProducts.slice(0, this.options.limit) : dbProducts;
    console.log(`Processing ${toProcess.length} products...\n`);

    const startTime = Date.now();
    let progress = 0;
    const total = toProcess.length;

    for (const dbProduct of toProcess) {
      progress++;
      this.stats.processed++;

      // Find matching CSV product by SKU (UPC)
      const csvProduct = csvProducts.get(dbProduct.sku);
      if (!csvProduct) {
        this.stats.skippedNoMatch++;
        continue;
      }

      // Skip if no images in CSV
      if (csvProduct.images.length === 0) {
        this.stats.skippedNoImages++;
        continue;
      }

      // Skip if already has images (handled in query if --skip-existing)
      if (this.options.skipExisting && dbProduct.hasImage) {
        this.stats.skippedExisting++;
        continue;
      }

      console.log(`[${progress}/${total}] ${dbProduct.name.substring(0, 50)} - ${csvProduct.images.length} image(s)`);

      try {
        const success = await this.processProductImages(csvProduct, dbProduct.postId, dbProduct.name);
        if (success) {
          this.stats.productsUpdated++;
        }
      } catch (error) {
        this.stats.errors.push({
          sku: dbProduct.sku,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Progress update every 50 products
      if (progress % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = progress / elapsed;
        const remaining = (total - progress) / rate;
        console.log(`\n--- Progress: ${progress}/${total} (${Math.round(progress / total * 100)}%) - ETA: ${Math.round(remaining)}s ---\n`);
      }
    }

    console.log('\n');
    return this.stats;
  }
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  STC Image Import Script (Direct SQL)  ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Image Size: 650x650px (WebP, 90% quality)`);
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log(`  Skip Existing: ${options.skipExisting}`);
  if (options.limit) {
    console.log(`  Product Limit: ${options.limit}`);
  }
  console.log();

  // Parse CSV to get image URLs
  const csvPath = join(process.cwd(), 'data', 'stc-product-feed.csv');

  if (!existsSync(csvPath)) {
    console.error(`Error: CSV file not found at ${csvPath}`);
    process.exit(1);
  }

  console.log(`Loading products from: ${csvPath}`);

  const parser = new STCCSVParser(csvPath);
  const allProducts = await parser.parseProducts();
  console.log(`✓ Parsed ${allProducts.length} products from CSV\n`);

  // Create lookup map by UPC (SKU)
  const productsByUpc = new Map<string, STCProduct>();
  for (const product of allProducts) {
    productsByUpc.set(product.upc, product);
  }
  console.log(`✓ Created UPC lookup map with ${productsByUpc.size} entries\n`);

  // Connect to database
  const connection = await createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('✓ Connected to Local MySQL database\n');

  // Import images
  const importer = new STCImageImporter(connection, options);
  await importer.init();

  try {
    const stats = await importer.importImages(productsByUpc);

    // Print summary
    console.log('=== IMAGE IMPORT SUMMARY ===');
    console.log(`Products processed: ${stats.processed}`);
    console.log(`Products updated: ${stats.productsUpdated}`);
    console.log(`Images uploaded: ${stats.imagesUploaded}`);
    console.log(`Skipped (existing images): ${stats.skippedExisting}`);
    console.log(`Skipped (no images in CSV): ${stats.skippedNoImages}`);
    console.log(`Skipped (no CSV match): ${stats.skippedNoMatch}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\nFirst 10 errors:');
      stats.errors.slice(0, 10).forEach(err => {
        console.log(`  - ${err.sku}: ${err.message}`);
      });
    }

    // Save report
    const duration = Date.now() - startTime;
    const report = {
      timestamp: new Date().toISOString(),
      duration: `${(duration / 1000).toFixed(2)}s`,
      ...stats,
    };

    const reportPath = join(process.cwd(), 'data', 'stc-image-import-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);

  } finally {
    await connection.end();
  }

  console.log('\n✓ Image import completed successfully');
}

main().catch(error => {
  console.error('\n✗ Image import failed:', error);
  process.exit(1);
});
