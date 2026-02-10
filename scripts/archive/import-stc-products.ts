#!/usr/bin/env bun

/**
 * STC Product Import Script
 *
 * Imports products from STC warehouse CSV into WordPress/WooCommerce MySQL database
 * Handles duplicate SKU detection, category mapping, and product source tracking
 * Products without images in the CSV are automatically skipped
 *
 * Usage:
 *   bun scripts/import-stc-products.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to import (default: all)
 *   --skip-images         Skip image downloads (faster import)
 *   --dry-run             Show what would be imported without making changes
 *   --no-variations       Disable variation detection (import all as simple)
 *   --update-existing     Update existing products instead of skipping
 */

import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { STCCSVParser, type STCProduct, type STCVariationGroup } from '../lib/import/stc-csv-parser';
import { ImageProcessor } from '../lib/import/image-processor';
import { getConnection } from '../lib/db';

// Import configuration
const PRICE_MULTIPLIER = 3;
const SALE_DISCOUNT_PERCENT = 10;
const SENTINEL_PRICE = 9999; // STC uses $9,999.00 as "price not available"

interface ImportOptions {
  limit?: number;
  skipImages: boolean;
  dryRun: boolean;
  detectVariations: boolean;
  updateExisting: boolean;
}

interface ImportStats {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  variableProducts: number;
  simpleProducts: number;
  variations: number;
  imagesProcessed: number;
  errors: Array<{ sku: string; message: string }>;
}

interface CategoryMapping {
  wcCategory: string;
  wcId: number;
  parentIds?: number[];
  status: string;
}

interface BrandMapping {
  wtCode: string | null;
  status: string;
  count: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    skipImages: false,
    dryRun: false,
    detectVariations: true,
    updateExisting: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--skip-images') {
      options.skipImages = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-variations') {
      options.detectVariations = false;
    } else if (arg === '--update-existing') {
      options.updateExisting = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
STC Product Import Script

Usage:
  bun scripts/import-stc-products.ts [options]

Options:
  --limit <n>           Limit number of products to import (default: all)
  --skip-images         Skip image downloads (faster import)
  --dry-run             Show what would be imported without making changes
  --no-variations       Disable variation detection (import all as simple)
  --update-existing     Update existing products instead of skipping
  --help, -h            Show this help message

Examples:
  bun scripts/import-stc-products.ts --limit 50
  bun scripts/import-stc-products.ts --dry-run --limit 10
  bun scripts/import-stc-products.ts --update-existing --limit 100
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Load STC category mapping from JSON file
 */
function loadSTCCategoryMapping(): Map<string, CategoryMapping> {
  const mappingPath = join(process.cwd(), 'data', 'stc-category-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (data.mapping && Object.keys(data.mapping).length > 0) {
      return new Map(Object.entries(data.mapping) as [string, CategoryMapping][]);
    }
    return new Map();
  } catch {
    console.warn('Warning: Could not load stc-category-mapping.json');
    return new Map();
  }
}

/**
 * Load STC brand mapping from JSON file
 */
function loadSTCBrandMapping(): Map<string, BrandMapping> {
  const mappingPath = join(process.cwd(), 'data', 'stc-brand-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (data.mapping && Object.keys(data.mapping).length > 0) {
      return new Map(Object.entries(data.mapping) as [string, BrandMapping][]);
    }
    return new Map();
  } catch {
    console.warn('Warning: Could not load stc-brand-mapping.json');
    return new Map();
  }
}

/**
 * Load manufacturer mapping (Williams Trading codes to term IDs)
 */
function loadManufacturerMapping(): Map<string, number> {
  const mappingPath = join(process.cwd(), 'data', 'manufacturer-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (data.codeToId && Object.keys(data.codeToId).length > 0) {
      return new Map(Object.entries(data.codeToId).map(([k, v]) => [k, v as number]));
    }
    return new Map();
  } catch {
    console.warn('Warning: Could not load manufacturer-mapping.json');
    return new Map();
  }
}

/**
 * Load excluded categories list
 */
function loadExcludedCategories(): Set<string> {
  const mappingPath = join(process.cwd(), 'data', 'stc-category-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (data.excluded && Array.isArray(data.excluded)) {
      return new Set(data.excluded.map((c: string) => c.toLowerCase()));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * Calculate prices based on import parameters
 */
function calculatePrices(wholesalePrice: number): { regular: number; sale: number } {
  const regular = Math.round(wholesalePrice * PRICE_MULTIPLIER * 100) / 100;
  const sale = Math.round(regular * (1 - SALE_DISCOUNT_PERCENT / 100) * 100) / 100;
  return { regular, sale };
}

/**
 * Main import class
 */
class STCProductImporter {
  private connection: mysql.Connection | null = null;
  private categoryMapping: Map<string, CategoryMapping>;
  private brandMapping: Map<string, BrandMapping>;
  private manufacturerMapping: Map<string, number>;
  private excludedCategories: Set<string>;
  private imageProcessor: ImageProcessor;
  private options: ImportOptions;
  private stats: ImportStats = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    variableProducts: 0,
    simpleProducts: 0,
    variations: 0,
    imagesProcessed: 0,
    errors: [],
  };
  private productTypeTerms: { simple: number; variable: number } = { simple: 0, variable: 0 };
  private unmappedCategories: Set<string> = new Set();
  private unmappedBrands: Set<string> = new Set();

  constructor(options: ImportOptions) {
    this.options = options;
    this.categoryMapping = loadSTCCategoryMapping();
    this.brandMapping = loadSTCBrandMapping();
    this.manufacturerMapping = loadManufacturerMapping();
    this.excludedCategories = loadExcludedCategories();
    this.imageProcessor = new ImageProcessor(join(process.cwd(), 'data', 'stc-image-cache'));

    if (this.categoryMapping.size > 0) {
      console.log(`✓ Loaded ${this.categoryMapping.size} STC category mappings`);
    }
    if (this.brandMapping.size > 0) {
      console.log(`✓ Loaded ${this.brandMapping.size} STC brand mappings`);
    }
    if (this.manufacturerMapping.size > 0) {
      console.log(`✓ Loaded ${this.manufacturerMapping.size} manufacturer (WT code) mappings`);
    }
    if (this.excludedCategories.size > 0) {
      console.log(`✓ Loaded ${this.excludedCategories.size} excluded category keywords`);
    }
  }

  async connect(): Promise<void> {
    this.connection = await getConnection();
    console.log('✓ Connected to Local MySQL database\n');

    await this.initProductTypeTerms();
    await this.imageProcessor.init();
  }

  /**
   * Initialize product_type taxonomy terms
   */
  private async initProductTypeTerms(): Promise<void> {
    if (!this.connection) return;

    for (const type of ['simple', 'variable']) {
      const [existing] = await this.connection.execute(
        `SELECT tt.term_taxonomy_id
         FROM wp_terms t
         JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
         WHERE t.slug = ? AND tt.taxonomy = 'product_type'`,
        [type]
      );

      if ((existing as any[]).length > 0) {
        if (type === 'simple') this.productTypeTerms.simple = (existing as any[])[0].term_taxonomy_id;
        if (type === 'variable') this.productTypeTerms.variable = (existing as any[])[0].term_taxonomy_id;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Check if product should be excluded based on categories
   */
  private shouldExclude(product: STCProduct): boolean {
    const categories = STCCSVParser.getCategories(product);
    for (const cat of categories) {
      const catLower = cat.toLowerCase();
      for (const excluded of this.excludedCategories) {
        if (catLower.includes(excluded)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if product already exists by SKU
   */
  async productExists(sku: string): Promise<{ postId: number; productSource: string } | null> {
    if (!this.connection) throw new Error('Not connected');

    const [rows] = await this.connection.execute(
      `SELECT pm.post_id, pm2.meta_value as product_source
       FROM wp_postmeta pm
       LEFT JOIN wp_postmeta pm2 ON pm.post_id = pm2.post_id AND pm2.meta_key = '_product_source'
       WHERE pm.meta_key = '_sku' AND pm.meta_value = ?`,
      [sku]
    );

    if ((rows as any[]).length > 0) {
      return {
        postId: (rows as any[])[0].post_id,
        productSource: (rows as any[])[0].product_source || '',
      };
    }
    return null;
  }

  /**
   * Update product source to include STC
   */
  private async updateProductSource(postId: number, currentSource: string): Promise<void> {
    if (!this.connection) return;

    const sources = currentSource ? currentSource.split(',').map(s => s.trim()) : [];
    if (!sources.includes('stc')) {
      sources.push('stc');
      const newSource = sources.join(',');

      // Check if meta exists
      const [existing] = await this.connection.execute(
        `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_source'`,
        [postId]
      );

      if ((existing as any[]).length > 0) {
        await this.connection.execute(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_source'`,
          [newSource, postId]
        );
      } else {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_source', ?)`,
          [postId, newSource]
        );
      }
    }
  }

  /**
   * Get WooCommerce category IDs for a product
   */
  private getCategoryIds(product: STCProduct): number[] {
    const categoryIds: number[] = [];
    const categories = STCCSVParser.getCategories(product);

    for (const cat of categories) {
      const mapping = this.categoryMapping.get(cat);
      if (mapping && mapping.wcId) {
        categoryIds.push(mapping.wcId);
        // Add parent categories
        if (mapping.parentIds) {
          categoryIds.push(...mapping.parentIds);
        }
      } else {
        this.unmappedCategories.add(cat);
      }
    }

    // Remove duplicates
    return [...new Set(categoryIds)];
  }

  /**
   * Get brand term ID for a product
   */
  private getBrandTermId(brand: string): number | null {
    const brandMapping = this.brandMapping.get(brand);
    if (brandMapping && brandMapping.wtCode) {
      const termId = this.manufacturerMapping.get(brandMapping.wtCode);
      if (termId) {
        return termId;
      }
    }

    this.unmappedBrands.add(brand);
    return null;
  }

  /**
   * Link product to categories
   */
  private async linkCategories(postId: number, categoryIds: number[]): Promise<void> {
    if (!this.connection) return;

    for (const termId of categoryIds) {
      const [ttRows] = await this.connection.execute(
        `SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id = ? AND taxonomy = 'product_cat'`,
        [termId]
      );

      if ((ttRows as any[]).length > 0) {
        const termTaxonomyId = (ttRows as any[])[0].term_taxonomy_id;

        await this.connection.execute(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [postId, termTaxonomyId]
        );

        await this.connection.execute(
          `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
          [termTaxonomyId]
        );
      }
    }
  }

  /**
   * Link product to brand taxonomy
   */
  private async linkBrand(postId: number, brand: string): Promise<void> {
    if (!this.connection) return;

    const termId = this.getBrandTermId(brand);
    if (!termId) return;

    const [ttRows] = await this.connection.execute(
      `SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id = ? AND taxonomy = 'product_brand'`,
      [termId]
    );

    if ((ttRows as any[]).length > 0) {
      const termTaxonomyId = (ttRows as any[])[0].term_taxonomy_id;

      await this.connection.execute(
        `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
        [postId, termTaxonomyId]
      );

      await this.connection.execute(
        `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
        [termTaxonomyId]
      );
    }
  }

  /**
   * Link product to product_type taxonomy
   */
  private async linkProductType(postId: number, type: 'simple' | 'variable'): Promise<void> {
    if (!this.connection) return;

    const termTaxonomyId = type === 'simple' ? this.productTypeTerms.simple : this.productTypeTerms.variable;
    if (!termTaxonomyId) return;

    await this.connection.execute(
      `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
      [postId, termTaxonomyId]
    );

    await this.connection.execute(
      `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
      [termTaxonomyId]
    );
  }

  /**
   * Process and upload images for a product
   */
  private async processImages(product: STCProduct): Promise<number[]> {
    if (this.options.skipImages || product.images.length === 0) {
      return [];
    }

    try {
      const uploaded = await this.imageProcessor.processAndUploadImages(
        product.images,
        product.name
      );
      this.stats.imagesProcessed += uploaded.length;
      return uploaded.map(img => img.mediaId);
    } catch (error) {
      console.warn(`  ⚠ Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Set product featured image and gallery
   */
  private async setProductImages(postId: number, imageIds: number[]): Promise<void> {
    if (!this.connection || imageIds.length === 0) return;

    // Set featured image (first image)
    await this.connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
      [postId, imageIds[0].toString()]
    );

    // Set gallery images (remaining images)
    if (imageIds.length > 1) {
      const galleryIds = imageIds.slice(1).join(',');
      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_image_gallery', ?)`,
        [postId, galleryIds]
      );
    }
  }

  /**
   * Add product attributes (Color, Material, etc.)
   */
  private async addProductAttributes(postId: number, product: STCProduct): Promise<void> {
    if (!this.connection) return;

    const attributes: Record<string, { name: string; value: string; position: number; is_visible: number; is_variation: number; is_taxonomy: number }> = {};
    let position = 0;

    if (product.color && product.color.trim()) {
      attributes['color'] = {
        name: 'Color',
        value: STCCSVParser.applyTitleCase(product.color),
        position: position++,
        is_visible: 1,
        is_variation: 0,
        is_taxonomy: 0,
      };
    }

    if (product.material && product.material.trim()) {
      attributes['material'] = {
        name: 'Material',
        value: STCCSVParser.applyTitleCase(product.material),
        position: position++,
        is_visible: 1,
        is_variation: 0,
        is_taxonomy: 0,
      };
    }

    if (Object.keys(attributes).length === 0) return;

    const serialized = this.serializeProductAttributes(attributes);
    await this.connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
      [postId, serialized]
    );
  }

  /**
   * Serialize product attributes to PHP format
   */
  private serializeProductAttributes(attributes: Record<string, any>): string {
    const entries = Object.entries(attributes);
    let result = `a:${entries.length}:{`;

    for (const [key, attr] of entries) {
      result += `s:${key.length}:"${key}";`;
      result += `a:6:{`;
      result += `s:4:"name";s:${attr.name.length}:"${attr.name}";`;
      result += `s:5:"value";s:${attr.value.length}:"${attr.value}";`;
      result += `s:8:"position";i:${attr.position};`;
      result += `s:10:"is_visible";i:${attr.is_visible};`;
      result += `s:12:"is_variation";i:${attr.is_variation};`;
      result += `s:11:"is_taxonomy";i:${attr.is_taxonomy};`;
      result += `}`;
    }

    result += `}`;
    return result;
  }

  /**
   * Import a simple product
   */
  async importSimpleProduct(product: STCProduct): Promise<number | null> {
    if (!this.connection) throw new Error('Not connected');

    const sku = product.upc;

    // Check if product exists
    const existing = await this.productExists(sku);
    if (existing) {
      if (this.options.updateExisting) {
        // Update product source to include STC
        await this.updateProductSource(existing.postId, existing.productSource);
        this.stats.updated++;
        return existing.postId;
      } else {
        this.stats.skipped++;
        return null;
      }
    }

    const wholesalePrice = parseFloat(product.price) || 0;

    // Skip products with sentinel price ($9,999 = "price not available")
    if (wholesalePrice >= SENTINEL_PRICE) {
      this.stats.skipped++;
      return null;
    }

    const { regular, sale } = calculatePrices(wholesalePrice);

    const name = STCCSVParser.applyTitleCase(product.name);
    const slug = STCCSVParser.generateSlug(name);
    const description = STCCSVParser.cleanDescription(product.description);
    const shortDescription = STCCSVParser.generateShortDescription(description);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would create simple: ${name} (SKU: ${sku}) - $${sale}`);
      this.stats.created++;
      this.stats.simpleProducts++;
      return -1;
    }

    try {
      // Process images first
      const imageIds = await this.processImages(product);

      // Insert into wp_posts
      const [postResult] = await this.connection.execute(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type,
          post_mime_type, comment_count
        ) VALUES (
          1, ?, ?, ?, ?,
          ?, 'publish', 'closed', 'closed', '',
          ?, '', '', ?, ?,
          '', 0, '', 0, 'product',
          '', 0
        )`,
        [now, now, description, name, shortDescription, slug, now, now]
      );

      const postId = (postResult as any).insertId;

      // Update GUID
      await this.connection.execute(
        `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
        [`http://maleq-local.local/?post_type=product&p=${postId}`, postId]
      );

      // Insert product meta
      const metaValues: [number, string, string][] = [
        [postId, '_sku', sku],
        [postId, '_regular_price', regular.toString()],
        [postId, '_sale_price', sale.toString()],
        [postId, '_price', sale.toString()],
        [postId, '_stock', '0'],
        [postId, '_stock_status', 'instock'],
        [postId, '_manage_stock', 'no'],
        [postId, '_backorders', 'no'],
        [postId, '_sold_individually', 'no'],
        [postId, '_virtual', 'no'],
        [postId, '_downloadable', 'no'],
        [postId, '_visibility', 'visible'],
        [postId, 'total_sales', '0'],
        [postId, '_wc_review_count', '0'],
        [postId, '_wc_average_rating', '0'],
        [postId, '_product_type', 'simple'],
        // STC-specific meta fields
        [postId, '_stc_handle', product.handle],
        [postId, '_stc_upc', product.upc],
        [postId, '_stc_brand', product.brand],
        [postId, '_stc_features', product.features],
        [postId, '_stc_functions', product.functions],
        [postId, '_product_source', 'stc'],
        [postId, '_stc_last_synced', new Date().toISOString()],
      ];

      // Add dimensions if available
      if (product.weight && parseFloat(product.weight) > 0) {
        metaValues.push([postId, '_weight', product.weight]);
      }
      if (product.length && parseFloat(product.length) > 0) {
        metaValues.push([postId, '_length', product.length]);
      }
      if (product.width && parseFloat(product.width) > 0) {
        metaValues.push([postId, '_width', product.width]);
      }
      if (product.height && parseFloat(product.height) > 0) {
        metaValues.push([postId, '_height', product.height]);
      }

      // Add custom STC dimensions
      if (product.insertableLength && parseFloat(product.insertableLength) > 0) {
        metaValues.push([postId, '_insertable_length', product.insertableLength]);
      }
      if (product.innerDiameter && parseFloat(product.innerDiameter) > 0) {
        metaValues.push([postId, '_inner_diameter', product.innerDiameter]);
      }

      for (const [pid, key, value] of metaValues) {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [pid, key, value]
        );
      }

      // Link to categories
      const categoryIds = this.getCategoryIds(product);
      await this.linkCategories(postId, categoryIds);

      // Link to brand
      await this.linkBrand(postId, product.brand);

      // Link to product_type taxonomy
      await this.linkProductType(postId, 'simple');

      // Add attributes
      await this.addProductAttributes(postId, product);

      // Set images
      await this.setProductImages(postId, imageIds);

      // Add to WooCommerce lookup table
      await this.connection.execute(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
        ) VALUES (?, ?, 0, 0, ?, ?, 1, 0, 'instock', 0, 0, 0)`,
        [postId, sku, sale, sale]
      );

      this.stats.created++;
      this.stats.simpleProducts++;
      return postId;

    } catch (error) {
      this.stats.errors.push({
        sku,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Import a variable product with variations
   */
  async importVariableProduct(group: STCVariationGroup): Promise<void> {
    if (!this.connection) throw new Error('Not connected');

    const skuBase = group.baseName.substring(0, 30).replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/-$/, '').toUpperCase();
    const parentSku = `STC-VAR-${skuBase}`;

    // Check if parent already exists
    const existing = await this.productExists(parentSku);
    if (existing) {
      if (this.options.updateExisting) {
        await this.updateProductSource(existing.postId, existing.productSource);
        this.stats.updated += group.products.length;
      } else {
        this.stats.skipped += group.products.length;
      }
      return;
    }

    // Filter out variations with sentinel price
    const validProducts = group.products.filter(p => {
      const price = parseFloat(p.price) || 0;
      if (price >= SENTINEL_PRICE) {
        this.stats.skipped++;
        return false;
      }
      return true;
    });

    if (validProducts.length === 0) {
      return;
    }

    // If only one valid product remains, import as simple instead
    if (validProducts.length === 1) {
      await this.importSimpleProduct(validProducts[0]);
      return;
    }

    const parser = new STCCSVParser('');
    const attrName = group.variationAttribute === 'color' ? 'Color' :
                     group.variationAttribute === 'size' ? 'Size' : 'Style';
    const variationOptions = validProducts.map(p =>
      parser.getVariationOption(p, group.variationAttribute)
    );

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would create variable: ${group.baseName}`);
      console.log(`          Variations (${validProducts.length}): ${variationOptions.slice(0, 5).join(', ')}${variationOptions.length > 5 ? '...' : ''}`);
      this.stats.variableProducts++;
      this.stats.variations += validProducts.length;
      this.stats.created += validProducts.length;
      return;
    }

    try {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const name = STCCSVParser.applyTitleCase(group.baseName);
      const slug = STCCSVParser.generateSlug(name);
      const description = STCCSVParser.cleanDescription(validProducts[0].description);
      const shortDescription = STCCSVParser.generateShortDescription(description);

      // Calculate price range
      const prices = validProducts.map(p => calculatePrices(parseFloat(p.price) || 0));
      const minPrice = Math.min(...prices.map(p => p.sale));
      const maxPrice = Math.max(...prices.map(p => p.sale));

      // Create parent product
      const [postResult] = await this.connection.execute(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type,
          post_mime_type, comment_count
        ) VALUES (
          1, ?, ?, ?, ?,
          ?, 'publish', 'closed', 'closed', '',
          ?, '', '', ?, ?,
          '', 0, '', 0, 'product',
          '', 0
        )`,
        [now, now, description, name, shortDescription, slug, now, now]
      );

      const parentId = (postResult as any).insertId;

      // Update GUID
      await this.connection.execute(
        `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
        [`http://maleq-local.local/?post_type=product&p=${parentId}`, parentId]
      );

      // Get or create the attribute taxonomy
      const taxonomy = `pa_${attrName.toLowerCase()}`;

      // Create terms for each variation option
      const termSlugs: string[] = [];
      for (const option of variationOptions) {
        const termSlug = option.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
        termSlugs.push(termSlug);

        // Check if term exists
        const [existing] = await this.connection.execute(
          `SELECT t.term_id, tt.term_taxonomy_id
           FROM wp_terms t
           JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
           WHERE t.slug = ? AND tt.taxonomy = ?`,
          [termSlug, taxonomy]
        );

        let termTaxonomyId: number;
        if ((existing as any[]).length > 0) {
          termTaxonomyId = (existing as any[])[0].term_taxonomy_id;
        } else {
          // Create term
          const [termResult] = await this.connection.execute(
            `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
            [option, termSlug]
          );
          const termId = (termResult as any).insertId;

          const [ttResult] = await this.connection.execute(
            `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?, ?, '', 0, 0)`,
            [termId, taxonomy]
          );
          termTaxonomyId = (ttResult as any).insertId;
        }

        // Link term to parent product
        await this.connection.execute(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
          [parentId, termTaxonomyId]
        );
      }

      // Parent product meta
      const parentMeta: [number, string, string][] = [
        [parentId, '_sku', parentSku],
        [parentId, '_price', minPrice.toString()],
        [parentId, '_regular_price', ''],
        [parentId, '_sale_price', ''],
        [parentId, '_manage_stock', 'no'],
        [parentId, '_stock_status', 'instock'],
        [parentId, '_virtual', 'no'],
        [parentId, '_downloadable', 'no'],
        [parentId, '_visibility', 'visible'],
        [parentId, 'total_sales', '0'],
        [parentId, '_wc_review_count', '0'],
        [parentId, '_wc_average_rating', '0'],
        [parentId, '_product_type', 'variable'],
        [parentId, '_product_source', 'stc'],
        [parentId, '_stc_brand', validProducts[0].brand],
        [parentId, '_stc_last_synced', new Date().toISOString()],
      ];

      // Serialize attribute data
      const attrData = `a:1:{s:${taxonomy.length}:"${taxonomy}";a:6:{s:4:"name";s:${taxonomy.length}:"${taxonomy}";s:5:"value";s:0:"";s:8:"position";i:0;s:10:"is_visible";i:1;s:12:"is_variation";i:1;s:11:"is_taxonomy";i:1;}}`;
      parentMeta.push([parentId, '_product_attributes', attrData]);

      // Set default attribute
      const firstTermSlug = termSlugs[0] || '';
      const defaultAttrSerialized = `a:1:{s:${taxonomy.length}:"${taxonomy}";s:${firstTermSlug.length}:"${firstTermSlug}";}`;
      parentMeta.push([parentId, '_default_attributes', defaultAttrSerialized]);

      for (const [pid, key, value] of parentMeta) {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [pid, key, value]
        );
      }

      // Link parent to categories
      const categoryIds = this.getCategoryIds(validProducts[0]);
      await this.linkCategories(parentId, categoryIds);

      // Link parent to brand
      await this.linkBrand(parentId, validProducts[0].brand);

      // Link to product_type taxonomy
      await this.linkProductType(parentId, 'variable');

      // Add to lookup table
      await this.connection.execute(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
        ) VALUES (?, ?, 0, 0, ?, ?, 1, 0, 'instock', 0, 0, 0)`,
        [parentId, parentSku, minPrice, maxPrice]
      );

      // Create variations
      for (let i = 0; i < validProducts.length; i++) {
        await this.createVariation(parentId, validProducts[i], taxonomy, termSlugs[i], i);
      }

      this.stats.variableProducts++;
      this.stats.variations += validProducts.length;
      this.stats.created += validProducts.length;

    } catch (error) {
      this.stats.errors.push({
        sku: parentSku,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Create a product variation
   */
  private async createVariation(
    parentId: number,
    product: STCProduct,
    taxonomy: string,
    termSlug: string,
    menuOrder: number
  ): Promise<void> {
    if (!this.connection) throw new Error('Not connected');

    const sku = product.upc;
    const wholesalePrice = parseFloat(product.price) || 0;
    const { regular, sale } = calculatePrices(wholesalePrice);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Create variation post
    const [postResult] = await this.connection.execute(
      `INSERT INTO wp_posts (
        post_author, post_date, post_date_gmt, post_content, post_title,
        post_excerpt, post_status, comment_status, ping_status, post_password,
        post_name, to_ping, pinged, post_modified, post_modified_gmt,
        post_content_filtered, post_parent, guid, menu_order, post_type,
        post_mime_type, comment_count
      ) VALUES (
        1, ?, ?, '', '',
        '', 'publish', 'closed', 'closed', '',
        '', '', '', ?, ?,
        '', ?, '', ?, 'product_variation',
        '', 0
      )`,
      [now, now, now, now, parentId, menuOrder]
    );

    const variationId = (postResult as any).insertId;

    // Update GUID
    await this.connection.execute(
      `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
      [`http://maleq-local.local/?post_type=product_variation&p=${variationId}`, variationId]
    );

    // Variation meta
    const varMeta: [number, string, string][] = [
      [variationId, '_sku', sku],
      [variationId, '_regular_price', regular.toString()],
      [variationId, '_sale_price', sale.toString()],
      [variationId, '_price', sale.toString()],
      [variationId, '_stock', '0'],
      [variationId, '_stock_status', 'instock'],
      [variationId, '_manage_stock', 'no'],
      [variationId, '_backorders', 'no'],
      [variationId, '_virtual', 'no'],
      [variationId, '_downloadable', 'no'],
      [variationId, `attribute_${taxonomy}`, termSlug],
    ];

    // Add dimensions
    if (product.weight && parseFloat(product.weight) > 0) {
      varMeta.push([variationId, '_weight', product.weight]);
    }
    if (product.length && parseFloat(product.length) > 0) {
      varMeta.push([variationId, '_length', product.length]);
    }
    if (product.width && parseFloat(product.width) > 0) {
      varMeta.push([variationId, '_width', product.width]);
    }
    if (product.height && parseFloat(product.height) > 0) {
      varMeta.push([variationId, '_height', product.height]);
    }

    // Add STC meta
    varMeta.push([variationId, '_stc_upc', product.upc]);
    varMeta.push([variationId, '_stc_handle', product.handle]);

    for (const [pid, key, value] of varMeta) {
      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [pid, key, value]
      );
    }

    // Process and set variation image
    if (!this.options.skipImages && product.images.length > 0) {
      const imageIds = await this.processImages(product);
      if (imageIds.length > 0) {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_thumbnail_id', ?)`,
          [variationId, imageIds[0].toString()]
        );
      }
    }

    // Add to lookup table
    await this.connection.execute(
      `INSERT INTO wp_wc_product_meta_lookup (
        product_id, sku, \`virtual\`, downloadable, min_price, max_price,
        onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
      ) VALUES (?, ?, 0, 0, ?, ?, 1, 0, 'instock', 0, 0, 0)`,
      [variationId, sku, sale, sale]
    );
  }

  /**
   * Import all products
   */
  async importProducts(products: STCProduct[]): Promise<ImportStats> {
    // Filter excluded products
    let filteredProducts = products.filter(p => !this.shouldExclude(p));
    const excludedCount = products.length - filteredProducts.length;

    if (excludedCount > 0) {
      console.log(`✓ Filtered out ${excludedCount} products from excluded categories`);
    }

    // Skip products with no images in the CSV
    const beforeImageFilter = filteredProducts.length;
    filteredProducts = filteredProducts.filter(p => p.images.length > 0);
    const skippedNoImages = beforeImageFilter - filteredProducts.length;
    if (skippedNoImages > 0) {
      console.log(`✓ Skipped ${skippedNoImages} products with no images`);
    }

    const toImport = this.options.limit ? filteredProducts.slice(0, this.options.limit) : filteredProducts;
    console.log(`Processing ${toImport.length} products...\n`);

    let variationGroups: STCVariationGroup[] = [];
    let simpleProducts: STCProduct[] = [];

    if (this.options.detectVariations) {
      console.log('Detecting variations...');
      const parser = new STCCSVParser('');
      variationGroups = parser.detectVariations(toImport);
      console.log(`Found ${variationGroups.length} variable products (${variationGroups.reduce((sum, g) => sum + g.products.length, 0)} total variations)`);

      // Get products not in variation groups
      const variationUpcs = new Set(variationGroups.flatMap(g => g.products.map(p => p.upc)));
      simpleProducts = toImport.filter(p => !variationUpcs.has(p.upc));
      console.log(`${simpleProducts.length} simple products\n`);
    } else {
      simpleProducts = toImport;
      console.log('Variation detection disabled\n');
    }

    // Import variable products
    let progress = 0;
    const totalVariableGroups = variationGroups.length;

    for (const group of variationGroups) {
      progress++;
      this.stats.processed += group.products.length;

      if (progress % 10 === 0 || progress === totalVariableGroups) {
        process.stdout.write(`\rVariable products: ${progress}/${totalVariableGroups}`);
      }

      await this.importVariableProduct(group);
    }

    if (totalVariableGroups > 0) {
      console.log('\n');
    }

    // Import simple products
    progress = 0;
    const totalSimple = simpleProducts.length;

    for (const product of simpleProducts) {
      progress++;
      this.stats.processed++;

      if (progress % 100 === 0 || progress === totalSimple) {
        process.stdout.write(`\rSimple products: ${progress}/${totalSimple} (${this.stats.simpleProducts} created, ${this.stats.skipped} skipped)`);
      }

      await this.importSimpleProduct(product);
    }

    console.log('\n');
    return this.stats;
  }

  /**
   * Get unmapped items for reporting
   */
  getUnmappedItems() {
    return {
      categories: [...this.unmappedCategories],
      brands: [...this.unmappedBrands],
    };
  }
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  STC Product Import Script             ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Price Multiplier: ${PRICE_MULTIPLIER}x`);
  console.log(`  Sale Discount: ${SALE_DISCOUNT_PERCENT}%`);
  console.log(`  Skip Images: ${options.skipImages}`);
  console.log(`  Detect Variations: ${options.detectVariations}`);
  console.log(`  Update Existing: ${options.updateExisting}`);
  console.log(`  Dry Run: ${options.dryRun}`);
  if (options.limit) {
    console.log(`  Product Limit: ${options.limit}`);
  }
  console.log();

  // Parse CSV
  const csvPath = join(process.cwd(), 'data', 'stc-product-feed.csv');

  if (!existsSync(csvPath)) {
    console.error(`Error: CSV file not found at ${csvPath}`);
    process.exit(1);
  }

  console.log(`Loading products from: ${csvPath}`);

  const parser = new STCCSVParser(csvPath);
  const allProducts = await parser.parseProducts();
  console.log(`✓ Parsed ${allProducts.length} products from CSV\n`);

  // Import products
  const importer = new STCProductImporter(options);

  try {
    await importer.connect();
    const stats = await importer.importProducts(allProducts);

    // Print summary
    console.log('=== IMPORT SUMMARY ===');
    console.log(`Processed: ${stats.processed}`);
    console.log(`Created: ${stats.created}`);
    console.log(`  - Variable Products: ${stats.variableProducts}`);
    console.log(`  - Variations: ${stats.variations}`);
    console.log(`  - Simple Products: ${stats.simpleProducts}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Skipped (existing): ${stats.skipped}`);
    console.log(`Images processed: ${stats.imagesProcessed}`);
    console.log(`Errors: ${stats.errors.length}`);

    // Print unmapped items
    const unmapped = importer.getUnmappedItems();
    if (unmapped.categories.length > 0) {
      console.log(`\n⚠ Unmapped categories (${unmapped.categories.length}):`);
      unmapped.categories.slice(0, 10).forEach(c => console.log(`  - ${c}`));
      if (unmapped.categories.length > 10) {
        console.log(`  ... and ${unmapped.categories.length - 10} more`);
      }
    }
    if (unmapped.brands.length > 0) {
      console.log(`\n⚠ Unmapped brands (${unmapped.brands.length}):`);
      unmapped.brands.slice(0, 10).forEach(b => console.log(`  - ${b}`));
      if (unmapped.brands.length > 10) {
        console.log(`  ... and ${unmapped.brands.length - 10} more`);
      }
    }

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
      unmappedCategories: unmapped.categories,
      unmappedBrands: unmapped.brands,
    };

    const reportPath = join(process.cwd(), 'data', 'stc-import-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);

  } finally {
    await importer.disconnect();
  }

  console.log('\n✓ Import completed successfully');
}

main().catch(error => {
  console.error('\n✗ Import failed:', error);
  process.exit(1);
});
