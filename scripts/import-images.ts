#!/usr/bin/env bun

/**
 * Image Import Script (Direct SQL)
 *
 * Imports images for existing products using direct MySQL access.
 * Implements the following logic:
 *
 * Simple Products:
 *   - Download and process ALL images
 *   - First image → Featured image
 *   - Additional images → Gallery images
 *
 * Variable Products (First Variation):
 *   - Download ALL images from first variation's XML source
 *   - First image → Parent product featured image
 *   - Additional images → Parent product gallery
 *   - First image → This variation's featured image
 *
 * Variable Products (Other Variations):
 *   - Download ONLY the first image
 *   - Set as variation's featured image
 *
 * Image Processing (via ImageProcessor):
 *   - Convert to WebP format
 *   - Resize to 650x650px on white canvas
 *   - Preserve aspect ratio (no cropping)
 *   - SEO-optimized filenames and alt text
 *   - Quality: 90%
 *
 * Usage:
 *   bun scripts/import-images.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to process
 *   --dry-run             Show what would be processed without downloading
 *   --product-id <id>     Process a specific product by ID
 *   --type <type>         Process only 'simple', 'variable', or 'variation'
 *   --skip-existing       Skip products that already have images
 *   --concurrency <n>     Number of concurrent image downloads (default: 5)
 */

import type { Connection } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { XMLParser, XMLProduct } from '../lib/import/xml-parser';
import { ImageProcessor } from '../lib/import/image-processor';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';

// WordPress uploads directory (Local by Flywheel - actual site directory)
const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const WP_SITE_URL = 'http://maleq-local.local';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  productId?: number;
  productType?: 'simple' | 'variable' | 'variation';
  skipExisting: boolean;
  concurrency: number;
  xmlFile?: string;
}

interface ProductToProcess {
  productId: number;
  productName: string;
  productSlug: string;
  sku: string;
  productType: string;
  parentId: number | null;
  isFirstVariation: boolean;
  xmlImages: string[];
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    skipExisting: false,
    concurrency: 5,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--product-id' && i + 1 < args.length) {
      options.productId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--type' && i + 1 < args.length) {
      options.productType = args[i + 1] as 'simple' | 'variable' | 'variation';
      i++;
    } else if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      options.concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--xml-file' && i + 1 < args.length) {
      options.xmlFile = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Image Import Script (Direct SQL)

Usage:
  bun scripts/import-images.ts [options]

Options:
  --limit <n>           Limit number of products to process
  --dry-run             Show what would be processed without downloading
  --product-id <id>     Process a specific product by ID
  --type <type>         Process only 'simple', 'variable', or 'variation'
  --skip-existing       Skip products that already have images
  --concurrency <n>     Number of concurrent image downloads (default: 5)
  --xml-file <path>     Load additional XML file for image lookups
  --help, -h            Show this help message

Examples:
  bun scripts/import-images.ts --limit 10 --dry-run
  bun scripts/import-images.ts --type simple --skip-existing
  bun scripts/import-images.ts --product-id 12345
  bun scripts/import-images.ts --skip-existing --xml-file data/inactive_products.xml
      `);
      process.exit(0);
    }
  }

  return options;
}

class DirectImageImporter {
  private connection: Connection;
  private imageProcessor: ImageProcessor;
  private xmlProducts: Map<string, XMLProduct> = new Map();

  // Stats
  private processedCount = 0;
  private successCount = 0;
  private errorCount = 0;
  private skippedCount = 0;
  private imagesDownloaded = 0;

  constructor(connection: Connection) {
    this.connection = connection;
    this.imageProcessor = new ImageProcessor();
  }

  /**
   * Initialize the importer
   */
  async init(): Promise<void> {
    await this.imageProcessor.init();
  }

  /**
   * Load XML products and create SKU lookup map
   */
  async loadXMLProducts(xmlPath: string): Promise<void> {
    const parser = new XMLParser(xmlPath);
    const products = await parser.parseProducts();

    for (const product of products) {
      // Map by both SKU and barcode for flexible lookup
      if (product.sku) {
        this.xmlProducts.set(product.sku.toUpperCase(), product);
      }
      if (product.barcode) {
        this.xmlProducts.set(product.barcode.toUpperCase(), product);
      }
    }

    console.log(`✓ Loaded ${products.length} products from XML`);
    console.log(`  - ${this.xmlProducts.size} SKU/barcode mappings created`);
  }

  /**
   * Get products that need images
   */
  async getProductsNeedingImages(options: ImportOptions): Promise<ProductToProcess[]> {
    let query = `
      SELECT
        p.ID as productId,
        p.post_title as productName,
        p.post_name as productSlug,
        pm_sku.meta_value as sku,
        (SELECT t.slug FROM wp_term_relationships tr
          INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
          INNER JOIN wp_terms t ON tt.term_id = t.term_id
          WHERE tr.object_id = p.ID AND tt.taxonomy = 'product_type'
          LIMIT 1) as productType,
        p.post_parent as parentId,
        p.menu_order as menuOrder
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm_sku ON p.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
      WHERE p.post_type IN ('product', 'product_variation')
      AND p.post_status = 'publish'
    `;

    const params: any[] = [];

    if (options.productId) {
      query += ' AND p.ID = ?';
      params.push(options.productId);
    }

    if (options.productType) {
      if (options.productType === 'variation') {
        query += " AND p.post_type = 'product_variation'";
      } else {
        query += ` AND EXISTS (
          SELECT 1 FROM wp_term_relationships tr2
          INNER JOIN wp_term_taxonomy tt2 ON tr2.term_taxonomy_id = tt2.term_taxonomy_id
          INNER JOIN wp_terms t2 ON tt2.term_id = t2.term_id
          WHERE tr2.object_id = p.ID AND tt2.taxonomy = 'product_type' AND t2.slug = ?
        )`;
        params.push(options.productType);
      }
    }

    if (options.skipExisting) {
      query += ` AND NOT EXISTS (
        SELECT 1 FROM wp_postmeta pm_thumb
        WHERE pm_thumb.post_id = p.ID
        AND pm_thumb.meta_key = '_thumbnail_id'
        AND pm_thumb.meta_value IS NOT NULL
        AND pm_thumb.meta_value != ''
        AND pm_thumb.meta_value != '0'
      )`;
    }

    query += ' ORDER BY p.post_type DESC, p.post_parent, p.menu_order, p.ID';

    const [rows] = await this.connection.execute(query, params);
    const products = rows as any[];

    // Track first variation for each parent
    const parentFirstVariation = new Map<number, number>();

    const result: ProductToProcess[] = [];

    for (const row of products) {
      const isVariation = row.productType === null && row.parentId > 0;
      let isFirstVariation = false;

      if (isVariation) {
        if (!parentFirstVariation.has(row.parentId)) {
          parentFirstVariation.set(row.parentId, row.productId);
          isFirstVariation = true;
        }
      }

      // Find XML product by SKU
      const sku = row.sku?.toUpperCase();
      const xmlProduct = sku ? this.xmlProducts.get(sku) : null;

      if (!xmlProduct) {
        continue; // Skip products without XML match
      }

      const xmlImages = xmlProduct.images || [];
      if (xmlImages.length === 0) {
        continue; // Skip products without images
      }

      result.push({
        productId: row.productId,
        productName: row.productName || xmlProduct.name,
        productSlug: row.productSlug,
        sku: row.sku,
        productType: isVariation ? 'variation' : (row.productType || 'simple'),
        parentId: row.parentId,
        isFirstVariation,
        xmlImages,
      });

      // Apply limit after XML matching (not on SQL query) so we get
      // the right number of matched products, not just DB rows
      if (options.limit && result.length >= options.limit) {
        break;
      }
    }

    return result;
  }

  /**
   * Get the uploads subdirectory for current month
   */
  getUploadsSubdir(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}/${month}`;
  }

  /**
   * Save processed image to WordPress uploads and create attachment
   */
  async createAttachment(
    imagePath: string,
    filename: string,
    productName: string,
    index: number
  ): Promise<number | null> {
    try {
      const subdir = this.getUploadsSubdir();
      const uploadDir = path.join(WP_UPLOADS_DIR, subdir);

      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Read processed image
      const imageBuffer = fs.readFileSync(imagePath);

      // Check if file exists, add hash if needed
      let finalFilename = filename;
      let filePath = path.join(uploadDir, finalFilename);

      if (fs.existsSync(filePath)) {
        const hash = createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
        finalFilename = filename.replace('.webp', `-${hash}.webp`);
        filePath = path.join(uploadDir, finalFilename);
      }

      // Write file to uploads
      fs.writeFileSync(filePath, imageBuffer);

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

      this.imagesDownloaded++;
      return attachmentId;
    } catch (error) {
      console.error(`  ✗ Failed to create attachment: ${error}`);
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
  async processProductImages(product: ProductToProcess, options: ImportOptions): Promise<boolean> {
    const { productId, productName, xmlImages, productType, isFirstVariation, parentId } = product;

    // Determine which images to download based on product type
    let imagesToDownload: string[];

    if (productType === 'variation' && !isFirstVariation) {
      // Non-first variations: only download first image
      imagesToDownload = xmlImages.slice(0, 1);
    } else {
      // Simple products, variable products, or first variation: download all
      imagesToDownload = xmlImages;
    }

    if (options.dryRun) {
      console.log(`  [DRY RUN] Would download ${imagesToDownload.length} image(s)`);
      return true;
    }

    try {
      // Process images using ImageProcessor (handles download, resize, webp conversion)
      // Note: Williams Trading images are at http://images.williams-trading.com/product_images
      const processedImages = await this.imageProcessor.processProductImages(
        imagesToDownload,
        productName,
        'http://images.williams-trading.com/product_images'
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

      // Set featured image for this product
      await this.setFeaturedImage(productId, attachmentIds[0]);

      // Handle gallery and parent images based on product type
      if (productType === 'variation' && isFirstVariation && parentId) {
        // First variation: set parent's featured and gallery images
        await this.setFeaturedImage(parentId, attachmentIds[0]);
        if (attachmentIds.length > 1) {
          await this.setGalleryImages(parentId, attachmentIds.slice(1));
        }
        console.log(`  ✓ Set parent (${parentId}) featured + ${attachmentIds.length - 1} gallery images`);
      } else if (productType === 'simple' || productType === 'variable') {
        // Simple/variable product: set gallery images
        if (attachmentIds.length > 1) {
          await this.setGalleryImages(productId, attachmentIds.slice(1));
        }
      }

      console.log(`  ✓ Added ${attachmentIds.length} image(s)`);
      return true;
    } catch (error) {
      console.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Process all products
   */
  async processAll(products: ProductToProcess[], options: ImportOptions): Promise<void> {
    const total = products.length;
    console.log(`\nProcessing ${total} products...\n`);

    const startTime = Date.now();

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      this.processedCount++;

      const imageCount = product.productType === 'variation' && !product.isFirstVariation
        ? 1
        : product.xmlImages.length;

      console.log(`[${this.processedCount}/${total}] ${product.productName} (${product.productType}) - ${imageCount} image(s)`);

      const success = await this.processProductImages(product, options);

      if (success) {
        this.successCount++;
      } else {
        this.errorCount++;
      }

      // Progress update every 10 products
      if (this.processedCount % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = this.processedCount / elapsed;
        const remaining = (total - this.processedCount) / rate;
        console.log(`\n--- Progress: ${this.processedCount}/${total} (${Math.round(this.processedCount / total * 100)}%) - ETA: ${Math.round(remaining)}s ---\n`);
      }
    }
  }

  /**
   * Print summary
   */
  printSummary(): void {
    console.log('\n=== IMAGE IMPORT SUMMARY ===');
    console.log(`Products Processed: ${this.processedCount}`);
    console.log(`  - Success: ${this.successCount}`);
    console.log(`  - Errors: ${this.errorCount}`);
    console.log(`  - Skipped: ${this.skippedCount}`);
    console.log(`Images Downloaded: ${this.imagesDownloaded}`);
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Product Image Import Script (SQL)     ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Image Size: 650x650px (WebP, 85% quality)`);
  console.log(`  Concurrency: ${options.concurrency}`);
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log(`  Skip Existing: ${options.skipExisting}`);
  if (options.limit) console.log(`  Limit: ${options.limit}`);
  if (options.productId) console.log(`  Product ID: ${options.productId}`);
  if (options.productType) console.log(`  Product Type: ${options.productType}`);
  if (options.xmlFile) console.log(`  Additional XML: ${options.xmlFile}`);

  // Connect to database
  const connection = await getConnection();

  console.log('\n✓ Connected to Local MySQL database');

  const importer = new DirectImageImporter(connection);
  await importer.init();

  // Load XML products
  const xmlPath = path.join(process.cwd(), 'data/products-filtered.xml');
  await importer.loadXMLProducts(xmlPath);

  // Load additional XML file if specified (e.g., inactive_products.xml)
  if (options.xmlFile) {
    const additionalPath = path.resolve(options.xmlFile);
    console.log(`\nLoading additional XML: ${additionalPath}`);
    await importer.loadXMLProducts(additionalPath);
  }

  // Get products needing images
  console.log('\nFinding products that need images...');
  const products = await importer.getProductsNeedingImages(options);
  console.log(`✓ Found ${products.length} products to process`);

  if (products.length === 0) {
    console.log('\nNo products need images. Exiting.');
    await connection.end();
    return;
  }

  // Show breakdown by type
  const simpleCount = products.filter(p => p.productType === 'simple').length;
  const variableCount = products.filter(p => p.productType === 'variable').length;
  const variationCount = products.filter(p => p.productType === 'variation').length;
  const firstVariationCount = products.filter(p => p.productType === 'variation' && p.isFirstVariation).length;

  console.log('\nBreakdown:');
  console.log(`  - Simple products: ${simpleCount}`);
  console.log(`  - Variable products: ${variableCount}`);
  console.log(`  - Variations: ${variationCount} (${firstVariationCount} first variations)`);

  // Show sample
  console.log('\nSample products:');
  for (const product of products.slice(0, 5)) {
    const imageCount = product.productType === 'variation' && !product.isFirstVariation
      ? '1 (non-first variation)'
      : `${product.xmlImages.length}`;
    console.log(`  - [${product.productType}${product.isFirstVariation ? '*' : ''}] ${product.productName.substring(0, 50)}: ${imageCount} image(s)`);
  }
  if (products.length > 5) {
    console.log(`  ... and ${products.length - 5} more`);
  }

  // Process images
  const startTime = Date.now();
  await importer.processAll(products, options);

  // Print summary
  importer.printSummary();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nDuration: ${duration}s`);

  await connection.end();
  console.log('\n✓ Image import completed');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
