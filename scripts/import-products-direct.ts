#!/usr/bin/env bun

/**
 * Direct SQL Product Import Script
 *
 * Imports products directly into WordPress/WooCommerce MySQL database
 * Bypasses the REST API for much faster imports
 * Supports variation detection and variable product creation
 *
 * Usage:
 *   bun scripts/import-products-direct.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to import (default: all)
 *   --skip-images         Skip image URLs (faster import)
 *   --dry-run             Show what would be imported without making changes
 *   --no-variations       Disable variation detection (import all as simple)
 */

import { join } from 'path';
import { XMLParser, XMLProduct, VariationGroup } from '../lib/import/xml-parser';
import { readFileSync, writeFileSync } from 'fs';
import { getConnection } from './lib/db';

// Import configuration
const PRICE_MULTIPLIER = 3;
const SALE_DISCOUNT_PERCENT = 10;

interface ImportOptions {
  limit?: number;
  skipImages: boolean;
  dryRun: boolean;
  detectVariations: boolean;
  barcodes?: string[];
  includeInactive: boolean;
}

interface ImportStats {
  processed: number;
  created: number;
  skipped: number;
  variableProducts: number;
  simpleProducts: number;
  variations: number;
  errors: Array<{ sku: string; message: string }>;
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
    includeInactive: false,
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
    } else if (arg === '--barcodes' && i + 1 < args.length) {
      // Comma-separated list of barcodes
      options.barcodes = args[i + 1].split(',').map(b => b.trim());
      options.includeInactive = true; // Auto-enable when using barcodes
      i++;
    } else if (arg === '--barcode-file' && i + 1 < args.length) {
      // Read barcodes from file (one per line)
      const filePath = args[i + 1];
      try {
        const content = readFileSync(filePath, 'utf-8');
        options.barcodes = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        options.includeInactive = true;
      } catch (err) {
        console.error(`Error reading barcode file: ${filePath}`);
        process.exit(1);
      }
      i++;
    } else if (arg === '--include-inactive') {
      options.includeInactive = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Direct SQL Product Import Script

Usage:
  bun scripts/import-products-direct.ts [options]

Options:
  --limit <n>           Limit number of products to import (default: all)
  --skip-images         Skip image URLs (faster import)
  --dry-run             Show what would be imported without making changes
  --no-variations       Disable variation detection (import all as simple)
  --barcodes <list>     Import only specific barcodes (comma-separated)
  --barcode-file <path> Import barcodes from file (one per line)
  --include-inactive    Also search inactive_products.xml
  --help, -h            Show this help message

Examples:
  bun scripts/import-products-direct.ts --limit 50
  bun scripts/import-products-direct.ts --dry-run --limit 10
  bun scripts/import-products-direct.ts --no-variations --limit 100
  bun scripts/import-products-direct.ts --barcodes 7350075022555,7350075022548
  bun scripts/import-products-direct.ts --barcode-file data/barcodes.txt
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Load category mapping from JSON file
 */
function loadCategoryMapping(): Map<string, number> {
  const mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    // The mapping file has { codeToId: {...}, codeToSlug: {...}, lastUpdated: "..." }
    if (data.codeToId && Object.keys(data.codeToId).length > 0) {
      return new Map(Object.entries(data.codeToId).map(([k, v]) => [k, v as number]));
    }
    return new Map();
  } catch {
    console.warn('Warning: Could not load category-mapping.json');
    return new Map();
  }
}

/**
 * Load manufacturer mapping from JSON file
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
 * Load excluded product types from JSON file
 */
function loadExcludedProductTypes(): Set<string> {
  const excludedPath = join(process.cwd(), 'data', 'excluded-product-types.json');
  try {
    const data = JSON.parse(readFileSync(excludedPath, 'utf-8'));
    const codes = new Set<string>();
    if (data.excludedTypes && Array.isArray(data.excludedTypes)) {
      for (const type of data.excludedTypes) {
        if (type.code) {
          codes.add(type.code.toUpperCase());
        }
      }
    }
    return codes;
  } catch {
    console.warn('Warning: Could not load excluded-product-types.json');
    return new Set();
  }
}

/**
 * Load product type to category mapping (fallback for products with no categories)
 */
function loadProductTypeCategoryMapping(): Map<string, string[]> {
  const mappingPath = join(process.cwd(), 'data', 'product-type-category-mapping.json');
  try {
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (data.typeToCategory && Object.keys(data.typeToCategory).length > 0) {
      return new Map(Object.entries(data.typeToCategory).map(([k, v]) => [k.toUpperCase(), v as string[]]));
    }
    return new Map();
  } catch {
    console.warn('Warning: Could not load product-type-category-mapping.json');
    return new Map();
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
 * Generate URL-friendly slug from product name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

/**
 * Main import class
 */
class DirectProductImporter {
  private connection: mysql.Connection | null = null;
  private categoryMapping: Map<string, number>;
  private manufacturerMapping: Map<string, number>;
  private productTypeCategoryMapping: Map<string, string[]>;
  private options: ImportOptions;
  private stats: ImportStats = {
    processed: 0,
    created: 0,
    skipped: 0,
    variableProducts: 0,
    simpleProducts: 0,
    variations: 0,
    errors: [],
  };
  // Cache for product_type term_taxonomy_ids
  private productTypeTerms: { simple: number; variable: number } = { simple: 0, variable: 0 };
  // Cache for category inference - stores products indexed by name words, sku prefix, and price
  private categoryInferenceCache: {
    byNameWords: Map<string, Array<{ product: XMLProduct; categories: Array<{ code: string }> }>>;
    bySkuPrefix: Map<string, Array<{ product: XMLProduct; categories: Array<{ code: string }> }>>;
    byPrice: Map<string, Array<{ product: XMLProduct; categories: Array<{ code: string }> }>>;
  } = {
    byNameWords: new Map(),
    bySkuPrefix: new Map(),
    byPrice: new Map(),
  };
  // Stats for category fallback
  private categoryFallbackStats = {
    productsWithNoCategories: 0,
    categoriesInferredFromSimilar: 0,
    categoriesFromProductType: 0,
    stillUncategorized: 0,
  };

  constructor(options: ImportOptions) {
    this.options = options;
    this.categoryMapping = loadCategoryMapping();
    this.manufacturerMapping = loadManufacturerMapping();
    this.productTypeCategoryMapping = loadProductTypeCategoryMapping();

    if (this.categoryMapping.size > 0) {
      console.log(`✓ Loaded ${this.categoryMapping.size} category mappings`);
    }
    if (this.manufacturerMapping.size > 0) {
      console.log(`✓ Loaded ${this.manufacturerMapping.size} manufacturer mappings`);
    }
    if (this.productTypeCategoryMapping.size > 0) {
      console.log(`✓ Loaded ${this.productTypeCategoryMapping.size} product type to category fallback mappings`);
    }
  }

  async connect(): Promise<void> {
    this.connection = await getConnection();
    console.log('✓ Connected to Local MySQL database\n');

    // Initialize product_type taxonomy terms
    await this.initProductTypeTerms();
  }

  /**
   * Initialize product_type taxonomy terms (simple, variable, etc.)
   * WooCommerce requires products to be linked to these taxonomy terms
   */
  private async initProductTypeTerms(): Promise<void> {
    if (!this.connection) return;

    const productTypes = ['simple', 'variable', 'grouped', 'external'];

    for (const type of productTypes) {
      // Check if term exists
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
      } else {
        // Create the term
        const [termResult] = await this.connection.execute(
          `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
          [type, type]
        );
        const termId = (termResult as any).insertId;

        const [ttResult] = await this.connection.execute(
          `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?, 'product_type', '', 0, 0)`,
          [termId]
        );
        const termTaxonomyId = (ttResult as any).insertId;

        if (type === 'simple') this.productTypeTerms.simple = termTaxonomyId;
        if (type === 'variable') this.productTypeTerms.variable = termTaxonomyId;
      }
    }
  }

  /**
   * Link a product to its product_type taxonomy term
   */
  private async linkProductType(postId: number, type: 'simple' | 'variable'): Promise<void> {
    if (!this.connection) return;

    const termTaxonomyId = type === 'simple' ? this.productTypeTerms.simple : this.productTypeTerms.variable;
    if (!termTaxonomyId) return;

    await this.connection.execute(
      `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
      [postId, termTaxonomyId]
    );

    // Update count
    await this.connection.execute(
      `UPDATE wp_term_taxonomy SET count = count + 1 WHERE term_taxonomy_id = ?`,
      [termTaxonomyId]
    );
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Build category inference cache from products with categories
   * This allows us to find similar products and copy their categories
   */
  buildCategoryInferenceCache(products: XMLProduct[]): void {
    console.log('Building category inference cache...');
    let productsWithCategories = 0;

    for (const product of products) {
      // Only cache products that have categories
      if (!product.categories || product.categories.length === 0) {
        continue;
      }

      // Only include categories that we have mappings for
      const validCategories = product.categories.filter(c => this.categoryMapping.has(c.code));
      if (validCategories.length === 0) {
        continue;
      }

      productsWithCategories++;
      const cacheEntry = { product, categories: validCategories };

      // Index by significant name words (excluding common words)
      const nameWords = this.extractSignificantWords(product.name);
      for (const word of nameWords) {
        if (!this.categoryInferenceCache.byNameWords.has(word)) {
          this.categoryInferenceCache.byNameWords.set(word, []);
        }
        this.categoryInferenceCache.byNameWords.get(word)!.push(cacheEntry);
      }

      // Index by SKU prefix (first 4-6 chars which usually indicate product line)
      const skuPrefixes = this.extractSkuPrefixes(product.sku);
      for (const prefix of skuPrefixes) {
        if (!this.categoryInferenceCache.bySkuPrefix.has(prefix)) {
          this.categoryInferenceCache.bySkuPrefix.set(prefix, []);
        }
        this.categoryInferenceCache.bySkuPrefix.get(prefix)!.push(cacheEntry);
      }

      // Index by price (rounded to nearest dollar)
      const priceKey = Math.round(parseFloat(product.price) || 0).toString();
      if (!this.categoryInferenceCache.byPrice.has(priceKey)) {
        this.categoryInferenceCache.byPrice.set(priceKey, []);
      }
      this.categoryInferenceCache.byPrice.get(priceKey)!.push(cacheEntry);
    }

    console.log(`✓ Cached ${productsWithCategories} products with categories for inference`);
    console.log(`  - ${this.categoryInferenceCache.byNameWords.size} unique name words`);
    console.log(`  - ${this.categoryInferenceCache.bySkuPrefix.size} unique SKU prefixes`);
    console.log(`  - ${this.categoryInferenceCache.byPrice.size} unique price points\n`);
  }

  /**
   * Extract significant words from product name for matching
   */
  private extractSignificantWords(name: string): string[] {
    // Common words to exclude
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      // Size words
      'small', 'medium', 'large', 'xl', 'xxl', 'mini', 'petite', 'plus', 'size',
      'sm', 'md', 'lg', 's', 'm', 'l',
      // Color words (too generic)
      'black', 'white', 'red', 'blue', 'green', 'pink', 'purple', 'clear',
      // Common product descriptors
      'new', 'pack', 'set', 'kit', 'oz', 'ml', 'inch', 'inches', 'piece', 'pieces',
    ]);

    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Extract SKU prefixes for matching
   */
  private extractSkuPrefixes(sku: string): string[] {
    const prefixes: string[] = [];
    const normalized = sku.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Extract various prefix lengths
    if (normalized.length >= 4) prefixes.push(normalized.substring(0, 4));
    if (normalized.length >= 6) prefixes.push(normalized.substring(0, 6));

    // Also extract letter-only prefix (brand codes are often letters)
    const letterPrefix = normalized.match(/^[A-Z]+/)?.[0];
    if (letterPrefix && letterPrefix.length >= 2) {
      prefixes.push(letterPrefix);
    }

    return prefixes;
  }

  /**
   * Try to infer categories for a product without categories
   * Uses similar products by name, SKU, or price
   */
  inferCategoriesFromSimilar(product: XMLProduct): XMLProduct['categories'] {
    // Collect category votes from similar products
    const categoryVotes = new Map<string, { count: number; name: string; parent: string }>();

    // Weight: name match = 3, SKU match = 2, price match = 1
    const addVotes = (categories: Array<{ code: string }>, weight: number) => {
      for (const cat of categories) {
        if (!categoryVotes.has(cat.code)) {
          categoryVotes.set(cat.code, { count: 0, name: '', parent: '0' });
        }
        categoryVotes.get(cat.code)!.count += weight;
      }
    };

    // Match by significant name words
    const nameWords = this.extractSignificantWords(product.name);
    const matchedByName = new Set<string>();
    for (const word of nameWords) {
      const matches = this.categoryInferenceCache.byNameWords.get(word) || [];
      for (const match of matches) {
        // Must share same manufacturer to be considered similar
        if (match.product.manufacturer.code === product.manufacturer.code) {
          const key = match.product.sku;
          if (!matchedByName.has(key)) {
            matchedByName.add(key);
            addVotes(match.categories, 3);
          }
        }
      }
    }

    // Match by SKU prefix
    const skuPrefixes = this.extractSkuPrefixes(product.sku);
    for (const prefix of skuPrefixes) {
      const matches = this.categoryInferenceCache.bySkuPrefix.get(prefix) || [];
      for (const match of matches) {
        addVotes(match.categories, 2);
      }
    }

    // Match by price (same manufacturer + similar price suggests similar product type)
    const priceKey = Math.round(parseFloat(product.price) || 0).toString();
    const priceMatches = this.categoryInferenceCache.byPrice.get(priceKey) || [];
    for (const match of priceMatches) {
      if (match.product.manufacturer.code === product.manufacturer.code) {
        addVotes(match.categories, 1);
      }
    }

    // Get categories with enough votes (at least 2 votes)
    const inferredCategories: XMLProduct['categories'] = [];
    for (const [code, data] of categoryVotes.entries()) {
      if (data.count >= 2) {
        inferredCategories.push({ code, name: data.name, parent: data.parent, video: '0' });
      }
    }

    // Sort by vote count (descending) and take top 3
    return inferredCategories
      .sort((a, b) => (categoryVotes.get(b.code)?.count || 0) - (categoryVotes.get(a.code)?.count || 0))
      .slice(0, 3);
  }

  /**
   * Get fallback categories for a product based on its type
   */
  getFallbackCategories(product: XMLProduct): XMLProduct['categories'] {
    const typeCode = product.type?.code?.toUpperCase();
    if (!typeCode) return [];

    const categoryCodes = this.productTypeCategoryMapping.get(typeCode);
    if (!categoryCodes || categoryCodes.length === 0) return [];

    return categoryCodes.map(code => ({
      code,
      name: '',
      parent: '0',
      video: '0',
    }));
  }

  /**
   * Get categories for a product, with fallback logic
   */
  getCategoriesWithFallback(product: XMLProduct): XMLProduct['categories'] {
    // Check if product already has valid categories
    const validCategories = product.categories.filter(c => this.categoryMapping.has(c.code));
    if (validCategories.length > 0) {
      return validCategories;
    }

    // Product has no categories - try to infer from similar products
    this.categoryFallbackStats.productsWithNoCategories++;

    // First try to infer from similar products
    const inferredCategories = this.inferCategoriesFromSimilar(product);
    if (inferredCategories.length > 0) {
      this.categoryFallbackStats.categoriesInferredFromSimilar++;
      return inferredCategories;
    }

    // Fall back to product type mapping
    const fallbackCategories = this.getFallbackCategories(product);
    if (fallbackCategories.length > 0) {
      this.categoryFallbackStats.categoriesFromProductType++;
      return fallbackCategories;
    }

    // Still no categories
    this.categoryFallbackStats.stillUncategorized++;
    return [];
  }

  /**
   * Check if product already exists by SKU
   */
  async productExists(sku: string): Promise<number | null> {
    if (!this.connection) throw new Error('Not connected');

    const [rows] = await this.connection.execute(
      `SELECT post_id FROM wp_postmeta WHERE meta_key = '_sku' AND meta_value = ?`,
      [sku]
    );
    return (rows as any[]).length > 0 ? (rows as any[])[0].post_id : null;
  }

  /**
   * Get or create a product attribute
   */
  async getOrCreateAttribute(attributeName: string): Promise<number> {
    if (!this.connection) throw new Error('Not connected');

    const slug = attributeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Check if attribute exists
    const [existing] = await this.connection.execute(
      `SELECT attribute_id FROM wp_woocommerce_attribute_taxonomies WHERE attribute_name = ?`,
      [slug]
    );

    if ((existing as any[]).length > 0) {
      return (existing as any[])[0].attribute_id;
    }

    // Create attribute
    const [result] = await this.connection.execute(
      `INSERT INTO wp_woocommerce_attribute_taxonomies (attribute_name, attribute_label, attribute_type, attribute_orderby, attribute_public)
       VALUES (?, ?, 'select', 'menu_order', 0)`,
      [slug, attributeName]
    );

    return (result as any).insertId;
  }

  /**
   * Get or create a term for an attribute value
   */
  async getOrCreateTerm(termName: string, taxonomy: string): Promise<{ termId: number; termTaxonomyId: number; slug: string }> {
    if (!this.connection) throw new Error('Not connected');

    const slug = termName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 200);

    // Check if term exists
    const [existing] = await this.connection.execute(
      `SELECT t.term_id, tt.term_taxonomy_id, t.slug
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE t.slug = ? AND tt.taxonomy = ?`,
      [slug, taxonomy]
    );

    if ((existing as any[]).length > 0) {
      return {
        termId: (existing as any[])[0].term_id,
        termTaxonomyId: (existing as any[])[0].term_taxonomy_id,
        slug: (existing as any[])[0].slug,
      };
    }

    // Create term
    const [termResult] = await this.connection.execute(
      `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
      [termName, slug]
    );
    const termId = (termResult as any).insertId;

    // Create term taxonomy
    const [ttResult] = await this.connection.execute(
      `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?, ?, '', 0, 0)`,
      [termId, taxonomy]
    );
    const termTaxonomyId = (ttResult as any).insertId;

    return { termId, termTaxonomyId, slug };
  }

  /**
   * Import a simple product
   */
  async importSimpleProduct(product: XMLProduct): Promise<number | null> {
    if (!this.connection) throw new Error('Not connected');

    // Skip inactive products entirely
    if (product.active !== '1') {
      this.stats.skipped++;
      return null;
    }

    const sku = product.barcode || product.sku;

    // Skip if already exists
    const existingId = await this.productExists(sku);
    if (existingId) {
      this.stats.skipped++;
      return null;
    }

    const wholesalePrice = parseFloat(product.price) || 0;
    const { regular, sale } = calculatePrices(wholesalePrice);

    const name = XMLParser.applyTitleCase(product.name);
    const slug = generateSlug(name);
    const description = XMLParser.cleanDescription(product.description);
    const shortDescription = XMLParser.generateShortDescription(description);
    const stockQty = parseInt(product.stock_quantity) || 0;
    const stockStatus = stockQty > 0 ? 'instock' : 'outofstock';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Determine post status from active flag
    const postStatus = product.active === '1' ? 'publish' : 'draft';

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would create simple: ${name} (SKU: ${sku}) - $${sale} [${postStatus}]`);
      this.stats.created++;
      this.stats.simpleProducts++;
      return -1;
    }

    try {
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
          ?, ?, 'closed', 'closed', '',
          ?, '', '', ?, ?,
          '', 0, '', 0, 'product',
          '', 0
        )`,
        [now, now, description, name, shortDescription, postStatus, slug, now, now]
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
        [postId, '_stock', stockQty.toString()],
        [postId, '_stock_status', stockStatus],
        [postId, '_manage_stock', 'yes'],
        [postId, '_backorders', 'no'],
        [postId, '_low_stock_amount', '3'],
        [postId, '_sold_individually', 'no'],
        [postId, '_virtual', 'no'],
        [postId, '_downloadable', 'no'],
        [postId, '_visibility', 'visible'],
        [postId, 'total_sales', '0'],
        [postId, '_wc_review_count', '0'],
        [postId, '_wc_average_rating', '0'],
        [postId, '_product_type', 'simple'],
        // Custom Williams Trading meta fields
        [postId, '_wt_sku', product.sku],
        [postId, '_wt_barcode', product.barcode],
        [postId, '_wt_manufacturer_code', product.manufacturer.code],
        [postId, '_wt_product_type_code', product.type.code],
        [postId, '_wt_release_date', product.release_date],
        [postId, '_wt_color', product.color],
        [postId, '_wt_material', product.material],
        [postId, '_wt_discountable', product.discountable],
        [postId, '_wt_active', product.active],
        [postId, '_wt_on_sale', product.on_sale],
        [postId, '_wt_last_synced', new Date().toISOString()],
      ];

      // Add dimensions if available
      if (product.weight && parseFloat(product.weight) > 0) {
        metaValues.push([postId, '_weight', product.weight]);
      }
      if (product.length && parseFloat(product.length) > 0) {
        metaValues.push([postId, '_length', product.length]);
      }
      if (product.diameter && parseFloat(product.diameter) > 0) {
        metaValues.push([postId, '_width', product.diameter]);
      }
      if (product.height && parseFloat(product.height) > 0) {
        metaValues.push([postId, '_height', product.height]);
      }

      for (const [pid, key, value] of metaValues) {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [pid, key, value]
        );
      }

      // Link to product categories (with fallback logic for products without categories)
      const categories = this.getCategoriesWithFallback(product);
      await this.linkCategories(postId, categories);

      // Link to brand taxonomy
      await this.linkBrand(postId, product.manufacturer.code);

      // Link to product_type taxonomy (required by WooCommerce)
      await this.linkProductType(postId, 'simple');

      // Add Color and Material as product attributes
      await this.addProductAttributes(postId, product);

      // Add to WooCommerce lookup table
      await this.connection.execute(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
        ) VALUES (?, ?, 0, 0, ?, ?, 1, ?, ?, 0, 0, 0)`,
        [postId, sku, sale, sale, stockQty, stockStatus]
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
  async importVariableProduct(group: VariationGroup): Promise<void> {
    if (!this.connection) throw new Error('Not connected');

    // Filter out inactive variations - only import active products
    const activeProducts = group.products.filter(p => p.active === '1');

    if (activeProducts.length === 0) {
      // No active variations, skip this entire product group
      console.log(`  ⊖ Skipping ${group.baseName} - no active variations`);
      this.stats.skipped += group.products.length;
      return;
    }

    if (activeProducts.length < group.products.length) {
      const skippedCount = group.products.length - activeProducts.length;
      console.log(`  ⊖ Filtering out ${skippedCount} inactive variation(s)`);
      this.stats.skipped += skippedCount;
      // Update the group to only contain active products
      group.products = activeProducts;
    }

    const firstProduct = group.products[0];
    // Generate SKU: replace non-alphanumeric with dashes, collapse multiple dashes, remove trailing dashes
    const skuBase = group.baseName.substring(0, 30).replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/-$/, '').toUpperCase();
    const parentSku = `VAR-${firstProduct.manufacturer.code}-${skuBase}`;

    // Check if parent already exists
    const existingId = await this.productExists(parentSku);
    if (existingId) {
      this.stats.skipped += group.products.length;
      return;
    }

    // Determine attribute name based on variation type
    const attrName = group.variationAttribute === 'flavor' ? 'Flavor' :
                     group.variationAttribute === 'color' ? 'Color' :
                     group.variationAttribute === 'size' ? 'Size' :
                     group.variationAttribute === 'style' ? 'Style' : 'Variant';

    // Use XMLParser's getVariationOption method for consistent extraction
    const parser = new XMLParser('');
    const variationOptions = group.products.map(p =>
      parser.getVariationOption(p, group.variationAttribute)
    );

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would create variable: ${group.baseName}`);
      console.log(`          Variations (${group.products.length}): ${variationOptions.slice(0, 5).join(', ')}${variationOptions.length > 5 ? '...' : ''}`);
      this.stats.variableProducts++;
      this.stats.variations += group.products.length;
      this.stats.created += group.products.length;
      return;
    }

    try {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const name = XMLParser.applyTitleCase(group.baseName);
      const slug = generateSlug(name);
      const description = XMLParser.cleanDescription(firstProduct.description);
      const shortDescription = XMLParser.generateShortDescription(description);

      // Calculate price range
      const prices = group.products.map(p => calculatePrices(parseFloat(p.price) || 0));
      const minPrice = Math.min(...prices.map(p => p.sale));
      const maxPrice = Math.max(...prices.map(p => p.sale));

      // Determine post status - publish if any variation is active, otherwise draft
      const hasActiveVariation = group.products.some(p => p.active === '1');
      const postStatus = hasActiveVariation ? 'publish' : 'draft';

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
          ?, ?, 'closed', 'closed', '',
          ?, '', '', ?, ?,
          '', 0, '', 0, 'product',
          '', 0
        )`,
        [now, now, description, name, shortDescription, postStatus, slug, now, now]
      );

      const parentId = (postResult as any).insertId;

      // Update GUID
      await this.connection.execute(
        `UPDATE wp_posts SET guid = ? WHERE ID = ?`,
        [`http://maleq-local.local/?post_type=product&p=${parentId}`, parentId]
      );

      // Get or create the attribute
      await this.getOrCreateAttribute(attrName);
      const taxonomy = `pa_${attrName.toLowerCase()}`;

      // Create terms for each variation option and link to parent
      // Store term slugs for use in variations
      const termSlugs: string[] = [];
      for (const option of variationOptions) {
        const { termId, termTaxonomyId, slug } = await this.getOrCreateTerm(option, taxonomy);
        termSlugs.push(slug);

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
        // Custom Williams Trading meta fields for parent
        [parentId, '_wt_manufacturer_code', firstProduct.manufacturer.code],
        [parentId, '_wt_product_type_code', firstProduct.type.code],
        [parentId, '_wt_last_synced', new Date().toISOString()],
      ];

      // Store attribute data
      const attrData = {
        [taxonomy]: {
          name: taxonomy,
          value: '',
          position: 0,
          is_visible: 1,
          is_variation: 1,
          is_taxonomy: 1,
        }
      };
      parentMeta.push([parentId, '_product_attributes', JSON.stringify(attrData).replace(/"/g, '\\"')]);

      // Set first variation as default (serialized PHP array format)
      // Format: a:1:{s:8:"pa_color";s:6:"orange";}
      const firstTermSlug = termSlugs[0] || '';
      const defaultAttrSerialized = `a:1:{s:${taxonomy.length}:"${taxonomy}";s:${firstTermSlug.length}:"${firstTermSlug}";}`;
      parentMeta.push([parentId, '_default_attributes', defaultAttrSerialized]);

      for (const [pid, key, value] of parentMeta) {
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [pid, key, value]
        );
      }

      // Fix the serialized attribute data
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_product_attributes'`,
        [this.serializeAttributes(attrName, taxonomy), parentId]
      );

      // Link parent to product categories (with fallback logic for products without categories)
      const categories = this.getCategoriesWithFallback(firstProduct);
      await this.linkCategories(parentId, categories);

      // Link parent to brand taxonomy
      await this.linkBrand(parentId, firstProduct.manufacturer.code);

      // Link to product_type taxonomy (required by WooCommerce)
      await this.linkProductType(parentId, 'variable');

      // Add parent to WooCommerce lookup table
      await this.connection.execute(
        `INSERT INTO wp_wc_product_meta_lookup (
          product_id, sku, \`virtual\`, downloadable, min_price, max_price,
          onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
        ) VALUES (?, ?, 0, 0, ?, ?, 1, 0, 'instock', 0, 0, 0)`,
        [parentId, parentSku, minPrice, maxPrice]
      );

      // Create variations
      for (let i = 0; i < group.products.length; i++) {
        const varProduct = group.products[i];
        const termSlug = termSlugs[i];
        await this.createVariation(parentId, varProduct, attrName, taxonomy, termSlug, i);
      }

      this.stats.variableProducts++;
      this.stats.variations += group.products.length;
      this.stats.created += group.products.length;

    } catch (error) {
      this.stats.errors.push({
        sku: parentSku,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Serialize product attributes for WooCommerce
   */
  private serializeAttributes(attrName: string, taxonomy: string): string {
    // PHP serialize format for WooCommerce attributes
    const data = {
      [taxonomy]: {
        name: taxonomy,
        value: '',
        position: 0,
        is_visible: 1,
        is_variation: 1,
        is_taxonomy: 1,
      }
    };

    // Simple PHP serialization
    const inner = `s:${taxonomy.length}:"${taxonomy}";a:6:{s:4:"name";s:${taxonomy.length}:"${taxonomy}";s:5:"value";s:0:"";s:8:"position";i:0;s:10:"is_visible";i:1;s:12:"is_variation";i:1;s:11:"is_taxonomy";i:1;}`;
    return `a:1:{${inner}}`;
  }

  /**
   * Create a product variation
   */
  private async createVariation(
    parentId: number,
    product: XMLProduct,
    attrName: string,
    taxonomy: string,
    optionValue: string,
    menuOrder: number
  ): Promise<void> {
    if (!this.connection) throw new Error('Not connected');

    const sku = product.barcode || product.sku;
    const wholesalePrice = parseFloat(product.price) || 0;
    const { regular, sale } = calculatePrices(wholesalePrice);
    const stockQty = parseInt(product.stock_quantity) || 0;
    const stockStatus = stockQty > 0 ? 'instock' : 'outofstock';
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
      [variationId, '_stock', stockQty.toString()],
      [variationId, '_stock_status', stockStatus],
      [variationId, '_manage_stock', 'yes'],
      [variationId, '_backorders', 'no'],
      [variationId, '_virtual', 'no'],
      [variationId, '_downloadable', 'no'],
      [variationId, `attribute_${taxonomy}`, optionValue], // optionValue is already the term slug
    ];

    // Add dimensions if available
    if (product.weight && parseFloat(product.weight) > 0) {
      varMeta.push([variationId, '_weight', product.weight]);
    }
    if (product.length && parseFloat(product.length) > 0) {
      varMeta.push([variationId, '_length', product.length]);
    }
    if (product.diameter && parseFloat(product.diameter) > 0) {
      varMeta.push([variationId, '_width', product.diameter]);
    }
    if (product.height && parseFloat(product.height) > 0) {
      varMeta.push([variationId, '_height', product.height]);
    }

    // Add custom Williams Trading meta fields for variations
    varMeta.push([variationId, '_wt_sku', product.sku]);
    varMeta.push([variationId, '_wt_barcode', product.barcode]);
    varMeta.push([variationId, '_wt_color', product.color]);
    varMeta.push([variationId, '_wt_material', product.material]);
    varMeta.push([variationId, '_low_stock_amount', '3']);

    for (const [pid, key, value] of varMeta) {
      await this.connection.execute(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
        [pid, key, value]
      );
    }

    // Add to WooCommerce lookup table
    await this.connection.execute(
      `INSERT INTO wp_wc_product_meta_lookup (
        product_id, sku, \`virtual\`, downloadable, min_price, max_price,
        onsale, stock_quantity, stock_status, rating_count, average_rating, total_sales
      ) VALUES (?, ?, 0, 0, ?, ?, 1, ?, ?, 0, 0, 0)`,
      [variationId, sku, sale, sale, stockQty, stockStatus]
    );
  }

  /**
   * Link a product to categories
   */
  private async linkCategories(postId: number, categories: XMLProduct['categories']): Promise<void> {
    if (!this.connection) return;

    for (const cat of categories) {
      const termId = this.categoryMapping.get(cat.code);
      if (termId) {
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
  }

  /**
   * Link a product to its brand (product_brand taxonomy)
   */
  private async linkBrand(postId: number, manufacturerCode: string): Promise<void> {
    if (!this.connection || this.manufacturerMapping.size === 0) return;

    const termId = this.manufacturerMapping.get(manufacturerCode);
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
   * Add product attributes (Color, Material) to a simple product
   */
  private async addProductAttributes(postId: number, product: XMLProduct): Promise<void> {
    if (!this.connection) return;

    const attributes: Record<string, { name: string; value: string; position: number; is_visible: number; is_variation: number; is_taxonomy: number }> = {};
    let position = 0;

    // Add Color attribute if present
    if (product.color && product.color.trim()) {
      attributes['Color'] = {
        name: 'Color',
        value: XMLParser.applyTitleCase(product.color),
        position: position++,
        is_visible: 1,
        is_variation: 0,
        is_taxonomy: 0,
      };
    }

    // Add Material attribute if present
    if (product.material && product.material.trim()) {
      attributes['Material'] = {
        name: 'Material',
        value: XMLParser.applyTitleCase(product.material),
        position: position++,
        is_visible: 1,
        is_variation: 0,
        is_taxonomy: 0,
      };
    }

    if (Object.keys(attributes).length === 0) return;

    // Serialize attributes in PHP format
    const serialized = this.serializeProductAttributes(attributes);

    await this.connection.execute(
      `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_attributes', ?)`,
      [postId, serialized]
    );
  }

  /**
   * Serialize product attributes to PHP format for WooCommerce
   */
  private serializeProductAttributes(attributes: Record<string, { name: string; value: string; position: number; is_visible: number; is_variation: number; is_taxonomy: number }>): string {
    const entries = Object.entries(attributes);
    let result = `a:${entries.length}:{`;

    for (const [key, attr] of entries) {
      const keyLower = key.toLowerCase();
      result += `s:${keyLower.length}:"${keyLower}";`;
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
   * Import all products with variation detection
   */
  async importProducts(products: XMLProduct[]): Promise<ImportStats> {
    const toImport = this.options.limit ? products.slice(0, this.options.limit) : products;

    console.log(`Processing ${toImport.length} products...\n`);

    // Build category inference cache from ALL products (not just toImport)
    // This maximizes our ability to infer categories for products without them
    this.buildCategoryInferenceCache(products);

    let variationGroups: VariationGroup[] = [];
    let simpleProducts: XMLProduct[] = [];

    if (this.options.detectVariations) {
      console.log('Detecting variations...');
      const parser = new XMLParser('');
      variationGroups = parser.detectVariations(toImport);
      console.log(`Found ${variationGroups.length} variable products (${variationGroups.reduce((sum, g) => sum + g.products.length, 0)} total variations)`);

      // Get products that are not part of variation groups
      const variationSkus = new Set(
        variationGroups.flatMap(g => g.products.map(p => p.sku))
      );
      simpleProducts = toImport.filter(p => !variationSkus.has(p.sku));
      console.log(`${simpleProducts.length} simple products\n`);
    } else {
      simpleProducts = toImport;
      console.log('Variation detection disabled - importing all as simple products\n');
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
   * Get category fallback stats
   */
  getCategoryFallbackStats() {
    return this.categoryFallbackStats;
  }
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Direct SQL Product Import Script     ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Price Multiplier: ${PRICE_MULTIPLIER}x`);
  console.log(`  Sale Discount: ${SALE_DISCOUNT_PERCENT}%`);
  console.log(`  Skip Images: ${options.skipImages}`);
  console.log(`  Detect Variations: ${options.detectVariations}`);
  console.log(`  Dry Run: ${options.dryRun}`);
  if (options.limit) {
    console.log(`  Product Limit: ${options.limit}`);
  }
  if (options.barcodes) {
    console.log(`  Barcodes Filter: ${options.barcodes.length} barcodes`);
  }
  if (options.includeInactive) {
    console.log(`  Include Inactive: yes`);
  }
  console.log();

  // Parse XML - potentially from multiple files
  let allProducts: XMLProduct[] = [];
  const barcodeSet = options.barcodes ? new Set(options.barcodes) : null;
  const foundBarcodes = new Set<string>();

  // Always search primary XML file first
  const primaryXmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  console.log(`Loading products from: ${primaryXmlPath}`);
  const primaryParser = new XMLParser(primaryXmlPath);
  const primaryProducts = await primaryParser.parseProducts();
  console.log(`✓ Parsed ${primaryProducts.length} products from products-filtered.xml`);

  if (barcodeSet) {
    // Filter by barcode
    for (const p of primaryProducts) {
      if (barcodeSet.has(p.barcode)) {
        allProducts.push(p);
        foundBarcodes.add(p.barcode);
      }
    }
    console.log(`  Found ${foundBarcodes.size} matching products`);
  } else {
    allProducts = primaryProducts;
  }

  // Search additional XML files if needed
  if (options.includeInactive && barcodeSet && foundBarcodes.size < barcodeSet.size) {
    const additionalFiles = [
      join(process.cwd(), 'data', 'products.xml'),
      join(process.cwd(), 'data', 'inactive_products.xml'),
    ];

    for (const xmlPath of additionalFiles) {
      if (foundBarcodes.size >= barcodeSet.size) break;

      try {
        const stat = await import('fs').then(fs => fs.existsSync(xmlPath));
        if (!stat) continue;

        console.log(`Searching: ${xmlPath.split('/').pop()}`);
        const parser = new XMLParser(xmlPath);
        const products = await parser.parseProducts();

        for (const p of products) {
          if (barcodeSet.has(p.barcode) && !foundBarcodes.has(p.barcode)) {
            // Force active status for barcode imports
            p.active = '1';
            allProducts.push(p);
            foundBarcodes.add(p.barcode);
            console.log(`  ✓ Found: ${p.barcode} - ${p.name.substring(0, 50)}...`);
          }
        }
      } catch (err) {
        // File doesn't exist or can't be parsed, skip
      }
    }

    // Report missing barcodes
    const missingBarcodes = [...barcodeSet].filter(b => !foundBarcodes.has(b));
    if (missingBarcodes.length > 0) {
      console.log(`\n⚠ Not found (${missingBarcodes.length}):`);
      for (const b of missingBarcodes) {
        console.log(`  ✗ ${b}`);
      }
    }
  }

  console.log(`\n✓ Total products to process: ${allProducts.length}`);

  // Filter out excluded product types
  const excludedTypes = loadExcludedProductTypes();
  if (excludedTypes.size > 0) {
    console.log(`✓ Loaded ${excludedTypes.size} excluded product type codes`);
  }

  const products = allProducts.filter(p => {
    const typeCode = p.type?.code?.toUpperCase();
    if (typeCode && excludedTypes.has(typeCode)) {
      return false;
    }
    return true;
  });

  const excludedCount = allProducts.length - products.length;
  if (excludedCount > 0) {
    console.log(`✓ Filtered out ${excludedCount} products with excluded types`);
  }
  console.log(`✓ ${products.length} products ready for import\n`);

  // Import products
  const importer = new DirectProductImporter(options);

  try {
    await importer.connect();
    const stats = await importer.importProducts(products);

    // Print summary
    console.log('=== IMPORT SUMMARY ===');
    console.log(`Processed: ${stats.processed}`);
    console.log(`Created: ${stats.created}`);
    console.log(`  - Variable Products: ${stats.variableProducts}`);
    console.log(`  - Variations: ${stats.variations}`);
    console.log(`  - Simple Products: ${stats.simpleProducts}`);
    console.log(`Skipped (existing): ${stats.skipped}`);
    console.log(`Errors: ${stats.errors.length}`);

    // Print category fallback stats
    const catStats = importer.getCategoryFallbackStats();
    if (catStats.productsWithNoCategories > 0) {
      console.log('\n=== CATEGORY FALLBACK ===');
      console.log(`Products without categories: ${catStats.productsWithNoCategories}`);
      console.log(`  - Categories inferred from similar products: ${catStats.categoriesInferredFromSimilar}`);
      console.log(`  - Categories from product type fallback: ${catStats.categoriesFromProductType}`);
      console.log(`  - Still uncategorized: ${catStats.stillUncategorized}`);
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
      categoryFallback: catStats,
    };

    const reportPath = join(process.cwd(), 'data', 'import-report-direct.json');
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
