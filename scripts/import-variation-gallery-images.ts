#!/usr/bin/env bun

/**
 * Import Missing Gallery Images for Variable Products
 *
 * Finds variable products that are missing gallery images and imports
 * additional images from XML/CSV sources. Prioritizes MUFFS/Williams Trading
 * XML as the primary source, falling back to STC CSV.
 *
 * Logic:
 * 1. Find variable products with no or insufficient gallery images
 * 2. For each product, collect all variation SKUs
 * 3. Look up each variation's images in MUFFS XML (active + inactive)
 * 4. Fall back to STC CSV if not found in MUFFS
 * 5. Gather images from primary variation first, then supplement from others
 * 6. Skip images already imported as variation featured images
 * 7. Import up to 8 total gallery images per parent product
 *
 * Usage:
 *   bun scripts/import-variation-gallery-images.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to process
 *   --dry-run             Show what would be done without making changes
 *   --product-id <id>     Process a specific parent product by ID
 *   --concurrency <n>     Number of concurrent image downloads (default: 5)
 *   --max-gallery <n>     Maximum gallery images per product (default: 8)
 *   --analyze             Only analyze and report, don't import
 */

import type { Connection } from 'mysql2/promise';
import { getConnection } from './lib/db';
import { XMLParser, type XMLProduct } from '../lib/import/xml-parser';
import { STCCSVParser, type STCProduct } from '../lib/import/stc-csv-parser';
import { ImageProcessor } from '../lib/import/image-processor';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';

const WP_UPLOADS_DIR = '/Users/lorencouse/Local Sites/maleq-local/app/public/wp-content/uploads';
const WP_SITE_URL = 'http://maleq-local.local';
const WT_IMAGE_BASE = 'http://images.williams-trading.com/product_images';

interface ImportOptions {
  limit?: number;
  dryRun: boolean;
  productId?: number;
  concurrency: number;
  maxGallery: number;
  analyze: boolean;
}

interface VariableProduct {
  parentId: number;
  parentTitle: string;
  parentSku: string;
  currentGalleryIds: number[];
  currentThumbnailId: number | null;
  variations: VariationInfo[];
}

interface VariationInfo {
  id: number;
  sku: string;
  menuOrder: number;
  thumbnailId: number | null;
}

interface ImageSource {
  url: string;
  source: 'muffs' | 'stc';
  variationSku: string;
  variationIndex: number; // image index within the variation
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    concurrency: 5,
    maxGallery: 8,
    analyze: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--analyze') {
      options.analyze = true;
    } else if (arg === '--product-id' && i + 1 < args.length) {
      options.productId = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      options.concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--max-gallery' && i + 1 < args.length) {
      options.maxGallery = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Import Missing Gallery Images for Variable Products

Usage:
  bun scripts/import-variation-gallery-images.ts [options]

Options:
  --limit <n>           Limit number of products to process
  --dry-run             Show what would be done without making changes
  --product-id <id>     Process a specific parent product by ID
  --concurrency <n>     Number of concurrent image downloads (default: 5)
  --max-gallery <n>     Maximum gallery images per product (default: 8)
  --analyze             Only analyze and report, don't import
  --help, -h            Show this help message

Examples:
  bun scripts/import-variation-gallery-images.ts --analyze --limit 20
  bun scripts/import-variation-gallery-images.ts --dry-run --limit 10
  bun scripts/import-variation-gallery-images.ts --product-id 12345
  bun scripts/import-variation-gallery-images.ts --limit 50
      `);
      process.exit(0);
    }
  }

  return options;
}

class VariationGalleryImporter {
  private connection: Connection;
  private imageProcessor: ImageProcessor;
  private muffsProducts: Map<string, XMLProduct> = new Map();
  private stcProducts: Map<string, STCProduct> = new Map();

  // Stats
  private stats = {
    productsAnalyzed: 0,
    productsNeedingImages: 0,
    productsUpdated: 0,
    imagesImported: 0,
    fromMuffs: 0,
    fromStc: 0,
    skippedAlreadyImported: 0,
    errors: 0,
  };

  constructor(connection: Connection) {
    this.connection = connection;
    this.imageProcessor = new ImageProcessor();
  }

  async init(): Promise<void> {
    await this.imageProcessor.init();
  }

  /**
   * Load MUFFS/Williams Trading XML products
   */
  async loadMuffsProducts(): Promise<void> {
    const dataDir = path.join(process.cwd(), 'data');

    // Load active products
    const activePath = path.join(dataDir, 'products-filtered.xml');
    if (fs.existsSync(activePath)) {
      console.log('Loading MUFFS active products...');
      const parser = new XMLParser(activePath);
      const products = await parser.parseProducts();
      for (const p of products) {
        if (p.sku) this.muffsProducts.set(p.sku.toUpperCase(), p);
        if (p.barcode) this.muffsProducts.set(p.barcode.toUpperCase(), p);
      }
      console.log(`  Loaded ${products.length} active products`);
    }

    // Load inactive products
    const inactivePath = path.join(dataDir, 'inactive_products.xml');
    if (fs.existsSync(inactivePath)) {
      console.log('Loading MUFFS inactive products...');
      const parser = new XMLParser(inactivePath);
      const products = await parser.parseProducts();
      let added = 0;
      for (const p of products) {
        // Don't overwrite active entries — active is preferred
        if (p.sku && !this.muffsProducts.has(p.sku.toUpperCase())) {
          this.muffsProducts.set(p.sku.toUpperCase(), p);
          added++;
        }
        if (p.barcode && !this.muffsProducts.has(p.barcode.toUpperCase())) {
          this.muffsProducts.set(p.barcode.toUpperCase(), p);
          added++;
        }
      }
      console.log(`  Loaded ${products.length} inactive products (${added} new mappings)`);
    }

    console.log(`  Total MUFFS lookup entries: ${this.muffsProducts.size}`);
  }

  /**
   * Load STC CSV products
   */
  async loadStcProducts(): Promise<void> {
    const csvPath = path.join(process.cwd(), 'data', 'stc-product-feed.csv');
    if (!fs.existsSync(csvPath)) {
      console.log('STC CSV not found, skipping STC fallback');
      return;
    }

    console.log('Loading STC products...');
    const parser = new STCCSVParser(csvPath);
    const products = await parser.parseProducts();
    for (const p of products) {
      if (p.upc) this.stcProducts.set(p.upc.toUpperCase(), p);
    }
    console.log(`  Loaded ${products.length} STC products (${this.stcProducts.size} UPC mappings)`);
  }

  /**
   * Find variable products with missing/insufficient gallery images
   */
  async getVariableProductsNeedingGallery(options: ImportOptions): Promise<VariableProduct[]> {
    let query = `
      SELECT
        p.ID as parentId,
        p.post_title as parentTitle,
        COALESCE(pm_sku.meta_value, '') as parentSku,
        pm_thumb.meta_value as thumbnailId,
        pm_gallery.meta_value as galleryIds
      FROM wp_posts p
      INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
      INNER JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      INNER JOIN wp_terms t ON tt.term_id = t.term_id
      LEFT JOIN wp_postmeta pm_sku ON p.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
      LEFT JOIN wp_postmeta pm_thumb ON p.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
      LEFT JOIN wp_postmeta pm_gallery ON p.ID = pm_gallery.post_id AND pm_gallery.meta_key = '_product_image_gallery'
      WHERE p.post_type = 'product'
        AND p.post_status = 'publish'
        AND tt.taxonomy = 'product_type'
        AND t.slug = 'variable'
    `;

    const params: any[] = [];

    if (options.productId) {
      query += ' AND p.ID = ?';
      params.push(options.productId);
    }

    query += ' ORDER BY p.ID';

    if (options.limit) {
      // We'll apply limit after filtering, but use a larger SQL limit to get enough candidates
      query += ` LIMIT ${options.limit * 3}`;
    }

    const [rows] = await this.connection.execute(query, params);
    const results: VariableProduct[] = [];

    for (const row of rows as any[]) {
      const thumbnailId = row.thumbnailId ? parseInt(row.thumbnailId, 10) : null;
      const galleryStr = row.galleryIds || '';
      const currentGalleryIds = galleryStr
        ? galleryStr.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id) && id > 0)
        : [];

      // Get variations for this parent
      const variations = await this.getVariations(row.parentId);

      if (variations.length === 0) continue;

      // Count existing gallery images (excluding variation thumbnails)
      const variationThumbnailIds = new Set(
        variations.map(v => v.thumbnailId).filter(Boolean) as number[]
      );

      // Gallery images that are NOT already variation thumbnails
      const trueGalleryImages = currentGalleryIds.filter(
        (id: number) => !variationThumbnailIds.has(id) && id !== thumbnailId
      );

      // If we already have enough non-variation gallery images, skip
      if (trueGalleryImages.length >= options.maxGallery) continue;

      results.push({
        parentId: row.parentId,
        parentTitle: row.parentTitle,
        parentSku: row.parentSku,
        currentGalleryIds,
        currentThumbnailId: thumbnailId && thumbnailId > 0 ? thumbnailId : null,
        variations,
      });

      if (options.limit && results.length >= options.limit) break;
    }

    return results;
  }

  /**
   * Get variations for a parent product
   */
  private async getVariations(parentId: number): Promise<VariationInfo[]> {
    const [rows] = await this.connection.execute(
      `SELECT
        v.ID as id,
        COALESCE(pm_sku.meta_value, '') as sku,
        v.menu_order as menuOrder,
        pm_thumb.meta_value as thumbnailId
      FROM wp_posts v
      LEFT JOIN wp_postmeta pm_sku ON v.ID = pm_sku.post_id AND pm_sku.meta_key = '_sku'
      LEFT JOIN wp_postmeta pm_thumb ON v.ID = pm_thumb.post_id AND pm_thumb.meta_key = '_thumbnail_id'
      WHERE v.post_parent = ?
        AND v.post_type = 'product_variation'
        AND v.post_status = 'publish'
      ORDER BY v.menu_order, v.ID`,
      [parentId]
    );

    return (rows as any[]).map(row => ({
      id: row.id,
      sku: row.sku || '',
      menuOrder: row.menuOrder || 0,
      thumbnailId: row.thumbnailId ? parseInt(row.thumbnailId, 10) : null,
    }));
  }

  /**
   * Find image URLs for a variation from XML/CSV sources.
   * Returns all image URLs available for this SKU.
   */
  private findImageSources(sku: string): { urls: string[]; source: 'muffs' | 'stc' } | null {
    if (!sku) return null;

    const upperSku = sku.toUpperCase();

    // Try MUFFS first (primary source of truth)
    const muffsProduct = this.muffsProducts.get(upperSku);
    if (muffsProduct && muffsProduct.images.length > 0) {
      return { urls: muffsProduct.images, source: 'muffs' };
    }

    // Fall back to STC
    const stcProduct = this.stcProducts.get(upperSku);
    if (stcProduct && stcProduct.images.length > 0) {
      return { urls: stcProduct.images, source: 'stc' };
    }

    return null;
  }

  /**
   * Collect additional images to import for a variable product.
   * Returns image URLs that should be added to the gallery, avoiding duplicates.
   */
  collectMissingImages(
    product: VariableProduct,
    maxGallery: number
  ): ImageSource[] {
    // Build set of image URLs already imported (by matching variation SKU → XML image[0])
    // We know that for non-first variations, only image[0] was imported.
    // For the first variation, all images were imported.
    const alreadyImportedUrls = new Set<string>();

    // Track which URLs we're planning to import to avoid duplicates
    const plannedUrls = new Set<string>();
    const imagesToImport: ImageSource[] = [];

    // Sort variations by menu_order to identify first variation
    const sortedVariations = [...product.variations].sort((a, b) => a.menuOrder - b.menuOrder);

    // Determine how many more gallery images we can add
    const currentGalleryCount = product.currentGalleryIds.length;
    let slotsAvailable = maxGallery - currentGalleryCount;

    if (slotsAvailable <= 0) return [];

    // Phase 1: For the first variation, ALL images were already imported.
    // Mark them as already imported.
    const firstVariation = sortedVariations[0];
    if (firstVariation) {
      const firstSources = this.findImageSources(firstVariation.sku);
      if (firstSources) {
        for (const url of firstSources.urls) {
          const fullUrl = this.resolveUrl(url, firstSources.source);
          alreadyImportedUrls.add(fullUrl);
        }
      }
    }

    // Phase 2: For non-first variations, only image[0] was imported.
    // Mark image[0] as imported, collect image[1+] as candidates.
    for (let vi = 1; vi < sortedVariations.length; vi++) {
      const variation = sortedVariations[vi];
      const sources = this.findImageSources(variation.sku);
      if (!sources) continue;

      // Mark first image as already imported (it was the variation thumbnail)
      if (sources.urls.length > 0) {
        const firstUrl = this.resolveUrl(sources.urls[0], sources.source);
        alreadyImportedUrls.add(firstUrl);
      }

      // Additional images (index 1+) are candidates for gallery
      for (let imgIdx = 1; imgIdx < sources.urls.length; imgIdx++) {
        if (slotsAvailable <= 0) break;

        const fullUrl = this.resolveUrl(sources.urls[imgIdx], sources.source);

        if (!alreadyImportedUrls.has(fullUrl) && !plannedUrls.has(fullUrl)) {
          imagesToImport.push({
            url: fullUrl,
            source: sources.source,
            variationSku: variation.sku,
            variationIndex: imgIdx,
          });
          plannedUrls.add(fullUrl);
          slotsAvailable--;
        }
      }
    }

    return imagesToImport;
  }

  /**
   * Resolve a potentially relative image URL to a full URL
   */
  private resolveUrl(url: string, source: 'muffs' | 'stc'): string {
    if (url.startsWith('http')) return url;
    if (source === 'muffs') return `${WT_IMAGE_BASE}${url}`;
    return url; // STC images are already full URLs
  }

  /**
   * Get current uploads subdirectory
   */
  private getUploadsSubdir(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}/${month}`;
  }

  /**
   * Create WordPress attachment from a processed image
   */
  private async createAttachment(
    imagePath: string,
    filename: string,
    productName: string,
    index: number
  ): Promise<number | null> {
    try {
      const subdir = this.getUploadsSubdir();
      const uploadDir = path.join(WP_UPLOADS_DIR, subdir);

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const imageBuffer = fs.readFileSync(imagePath);

      let finalFilename = filename;
      let filePath = path.join(uploadDir, finalFilename);

      if (fs.existsSync(filePath)) {
        // Check if an attachment already exists for this file
        const [existingAttachment] = await this.connection.execute(
          `SELECT ID FROM wp_posts WHERE post_type = 'attachment' AND guid LIKE ?`,
          [`%/${filename}`]
        );
        if ((existingAttachment as any[]).length > 0) {
          return (existingAttachment as any[])[0].ID;
        }

        const hash = createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
        finalFilename = filename.replace('.webp', `-${hash}.webp`);
        filePath = path.join(uploadDir, finalFilename);
      }

      fs.writeFileSync(filePath, imageBuffer);

      const altText = `${productName} - Image ${index}`;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const guid = `${WP_SITE_URL}/wp-content/uploads/${subdir}/${finalFilename}`;

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

      const attachedFile = `${subdir}/${finalFilename}`;
      const metadata = {
        width: 650,
        height: 650,
        file: attachedFile,
        filesize: imageBuffer.length,
        sizes: {},
        image_meta: {
          aperture: '0', credit: '', camera: '', caption: '',
          created_timestamp: '0', copyright: '', focal_length: '0',
          iso: '0', shutter_speed: '0', title: '', orientation: '1', keywords: [],
        },
      };

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

      this.stats.imagesImported++;
      return attachmentId;
    } catch (error) {
      console.error(`  Failed to create attachment: ${error}`);
      return null;
    }
  }

  /**
   * Append attachment IDs to existing gallery
   */
  private async appendGalleryImages(productId: number, newAttachmentIds: number[]): Promise<void> {
    if (newAttachmentIds.length === 0) return;

    // Get current gallery
    const [rows] = await this.connection.execute(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_image_gallery'`,
      [productId]
    );

    const currentGallery = (rows as any[])[0]?.meta_value || '';
    const existingIds = currentGallery
      ? currentGallery.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id) && id > 0)
      : [];

    // Merge, avoiding duplicates
    const existingSet = new Set(existingIds);
    const merged = [...existingIds];
    for (const id of newAttachmentIds) {
      if (!existingSet.has(id)) {
        merged.push(id);
        existingSet.add(id);
      }
    }

    const galleryValue = merged.join(',');

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
   * Process a single variable product
   */
  async processProduct(product: VariableProduct, options: ImportOptions): Promise<boolean> {
    const missingImages = this.collectMissingImages(product, options.maxGallery);

    if (missingImages.length === 0) {
      return false;
    }

    const muffsCount = missingImages.filter(i => i.source === 'muffs').length;
    const stcCount = missingImages.filter(i => i.source === 'stc').length;

    console.log(`  Found ${missingImages.length} missing gallery images (MUFFS: ${muffsCount}, STC: ${stcCount})`);
    console.log(`  Current gallery: ${product.currentGalleryIds.length} images`);

    if (options.analyze || options.dryRun) {
      for (const img of missingImages) {
        const shortUrl = img.url.length > 70 ? '...' + img.url.slice(-67) : img.url;
        console.log(`    [${img.source}] var:${img.variationSku} img:${img.variationIndex} - ${shortUrl}`);
      }
      return true;
    }

    // Download and process images
    const newAttachmentIds: number[] = [];
    const existingGalleryCount = product.currentGalleryIds.length;

    for (let i = 0; i < missingImages.length; i++) {
      const img = missingImages[i];
      const imageIndex = existingGalleryCount + i + 1; // Continue numbering

      try {
        const baseUrl = img.source === 'muffs' ? WT_IMAGE_BASE : '';

        // Use ImageProcessor for download + resize + WebP conversion
        const processed = await this.imageProcessor.processProductImages(
          [img.url],
          product.parentTitle,
          img.url.startsWith('http') ? '' : baseUrl
        );

        if (processed.length === 0) {
          console.log(`    Failed to process image from ${img.source}`);
          continue;
        }

        // Rename the processed file to avoid collision with existing product images
        // Generate a unique filename based on product name + gallery index
        const slug = product.parentTitle
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim()
          .substring(0, 50);
        const galleryFilename = `${slug}-gallery-${imageIndex}.webp`;

        // Rename in cache if needed
        const processedImg = processed[0];
        const renamedPath = path.join(path.dirname(processedImg.localPath), galleryFilename);
        if (processedImg.localPath !== renamedPath && !fs.existsSync(renamedPath)) {
          fs.copyFileSync(processedImg.localPath, renamedPath);
        }
        const finalPath = fs.existsSync(renamedPath) ? renamedPath : processedImg.localPath;

        const attachmentId = await this.createAttachment(
          finalPath,
          galleryFilename,
          product.parentTitle,
          imageIndex
        );

        if (attachmentId) {
          newAttachmentIds.push(attachmentId);
          if (img.source === 'muffs') this.stats.fromMuffs++;
          else this.stats.fromStc++;
          console.log(`    Imported image ${imageIndex} (${img.source}, attachment: ${attachmentId})`);
        }
      } catch (error) {
        console.error(`    Error processing image: ${error instanceof Error ? error.message : 'Unknown'}`);
        this.stats.errors++;
      }
    }

    if (newAttachmentIds.length > 0) {
      await this.appendGalleryImages(product.parentId, newAttachmentIds);
      console.log(`  Added ${newAttachmentIds.length} new gallery images (total: ${product.currentGalleryIds.length + newAttachmentIds.length})`);
      this.stats.productsUpdated++;
      return true;
    }

    return false;
  }

  /**
   * Simple PHP serialize for metadata
   */
  private phpSerialize(obj: any): string {
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
   * Print final stats
   */
  printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('GALLERY IMAGE IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Products analyzed:     ${this.stats.productsAnalyzed}`);
    console.log(`Products needing imgs: ${this.stats.productsNeedingImages}`);
    console.log(`Products updated:      ${this.stats.productsUpdated}`);
    console.log(`Images imported:       ${this.stats.imagesImported}`);
    console.log(`  From MUFFS:          ${this.stats.fromMuffs}`);
    console.log(`  From STC:            ${this.stats.fromStc}`);
    console.log(`Errors:                ${this.stats.errors}`);
    console.log('='.repeat(60));
  }

  get statsData() {
    return this.stats;
  }
}

async function main() {
  const options = parseArgs();

  console.log('\n' + '='.repeat(60));
  console.log('  Import Missing Gallery Images for Variable Products');
  console.log('='.repeat(60) + '\n');

  console.log('Configuration:');
  console.log(`  Max Gallery Images: ${options.maxGallery}`);
  console.log(`  Concurrency: ${options.concurrency}`);
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log(`  Analyze Only: ${options.analyze}`);
  if (options.limit) console.log(`  Limit: ${options.limit}`);
  if (options.productId) console.log(`  Product ID: ${options.productId}`);
  console.log();

  const connection = await getConnection();
  console.log('Connected to database\n');

  const importer = new VariationGalleryImporter(connection);
  await importer.init();

  // Load data sources
  await importer.loadMuffsProducts();
  await importer.loadStcProducts();
  console.log();

  // Find products needing gallery images
  console.log('Finding variable products with missing gallery images...');
  const products = await importer.getVariableProductsNeedingGallery(options);
  console.log(`Found ${products.length} variable products to process\n`);

  if (products.length === 0) {
    console.log('No products need gallery images. Exiting.');
    await connection.end();
    return;
  }

  // Show breakdown
  let totalMissing = 0;
  for (const product of products) {
    const missing = importer.collectMissingImages(product, options.maxGallery);
    if (missing.length > 0) totalMissing += missing.length;
  }
  console.log(`Estimated missing gallery images: ${totalMissing}\n`);

  // Process products
  const startTime = Date.now();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    importer.statsData.productsAnalyzed++;

    const missing = importer.collectMissingImages(product, options.maxGallery);
    if (missing.length === 0) {
      continue;
    }

    importer.statsData.productsNeedingImages++;

    console.log(`[${i + 1}/${products.length}] ${product.parentTitle} (ID: ${product.parentId})`);
    console.log(`  Variations: ${product.variations.length}, Current gallery: ${product.currentGalleryIds.length}`);

    await importer.processProduct(product, options);
    console.log();

    // Progress update every 25 products
    if ((i + 1) % 25 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const remaining = (products.length - i - 1) / rate;
      console.log(`--- Progress: ${i + 1}/${products.length} (${Math.round((i + 1) / products.length * 100)}%) - ETA: ${Math.round(remaining)}s ---\n`);
    }
  }

  importer.printSummary();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Duration: ${duration}s`);

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    duration: `${duration}s`,
    options: {
      maxGallery: options.maxGallery,
      dryRun: options.dryRun,
      analyze: options.analyze,
      limit: options.limit,
      productId: options.productId,
    },
    stats: importer.statsData,
  };

  const reportPath = path.join(process.cwd(), 'data', 'gallery-image-import-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  await connection.end();
  console.log('\nDone.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
