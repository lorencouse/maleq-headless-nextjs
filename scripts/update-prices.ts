#!/usr/bin/env bun

/**
 * Price Update Script
 *
 * Updates product prices using a smooth logarithmic markup curve based on wholesale price.
 *
 * Markup curve (logarithmic decay):
 *   - ≤$5: 5.0x (maximum)
 *   - $5-$100: smooth logarithmic transition
 *   - ≥$100: 2.1x (minimum)
 *
 * The logarithmic curve provides natural decay where lower prices
 * see larger multiplier changes, tapering off at higher prices.
 *
 * Sale price is always 10% off the regular price.
 *
 * Uses DIRECT MySQL connection for maximum speed (not REST API).
 *
 * Usage:
 *   bun scripts/update-prices.ts --analyze        # Show price changes without applying
 *   bun scripts/update-prices.ts --dry-run       # Show detailed changes for first 50 products
 *   bun scripts/update-prices.ts --apply         # Apply price updates to database
 *   bun scripts/update-prices.ts --apply --limit 100   # Apply to first 100 products
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { XMLParser, type XMLProduct } from '../lib/import/xml-parser';
import { getConnection } from './lib/db';

// Sale discount percentage
const SALE_DISCOUNT_PERCENT = 10;

// Multiplier curve parameters
const MAX_MULTIPLIER = 3.0;    // Maximum multiplier (at or below MIN_PRICE)
const MIN_MULTIPLIER = 2.1;    // Minimum multiplier (at or above MAX_PRICE)
const MIN_PRICE = 5;           // Price threshold where curve begins
const MAX_PRICE = 100;         // Price threshold where curve ends

interface ProductPrice {
  postId: number;
  postType: string;
  parentId: number | null;
  sku: string;
  barcode: string;
  currentRegularPrice: string;
  currentSalePrice: string;
  currentPrice: string;
  productTitle: string;
}

interface PriceUpdate {
  postId: number;
  productTitle: string;
  sku: string;
  postType: string;
  wholesalePrice: number;
  currentRegularPrice: number;
  newRegularPrice: number;
  currentSalePrice: number;
  newSalePrice: number;
  multiplier: number;
}

interface PriceStats {
  total: number;
  matched: number;
  updated: number;
  skipped: number;
  errors: Array<{ sku: string; message: string }>;
  // Price range buckets for analysis
  byRange: {
    under5: number;      // <=$5
    range5to10: number;  // $5-$10
    range10to25: number; // $10-$25
    range25to50: number; // $25-$50
    range50to100: number; // $50-$100
    over100: number;     // >$100
  };
  // Track multiplier distribution
  multiplierSum: number;
  multiplierCount: number;
}

/**
 * Calculate markup multiplier using smooth logarithmic curve
 *
 * Formula: For prices between MIN_PRICE and MAX_PRICE, uses logarithmic interpolation
 * This creates a smooth curve where:
 * - At $5 (MIN_PRICE): multiplier = 5.0x
 * - At $100 (MAX_PRICE): multiplier = 2.1x
 * - Below $5: flat at 5.0x
 * - Above $100: flat at 2.1x
 *
 * The logarithmic curve provides a natural decay where lower prices
 * see larger multiplier changes, tapering off at higher prices.
 */
function getMarkupMultiplier(wholesalePrice: number): number {
  // Below minimum threshold: use max multiplier
  if (wholesalePrice <= MIN_PRICE) {
    return MAX_MULTIPLIER;
  }

  // Above maximum threshold: use min multiplier
  if (wholesalePrice >= MAX_PRICE) {
    return MIN_MULTIPLIER;
  }

  // Logarithmic interpolation between MIN_PRICE and MAX_PRICE
  // multiplier = MAX - (MAX - MIN) * ln(price/MIN_PRICE) / ln(MAX_PRICE/MIN_PRICE)
  const logRatio = Math.log(wholesalePrice / MIN_PRICE) / Math.log(MAX_PRICE / MIN_PRICE);
  const multiplier = MAX_MULTIPLIER - (MAX_MULTIPLIER - MIN_MULTIPLIER) * logRatio;

  // Round to 2 decimal places for cleaner display
  return Math.round(multiplier * 100) / 100;
}

/**
 * Get multiplier info for display
 */
function getMultiplierInfo(wholesalePrice: number): string {
  const multiplier = getMarkupMultiplier(wholesalePrice);
  if (wholesalePrice <= MIN_PRICE) {
    return `≤$${MIN_PRICE} (${multiplier}x max)`;
  }
  if (wholesalePrice >= MAX_PRICE) {
    return `≥$${MAX_PRICE} (${multiplier}x min)`;
  }
  return `$${wholesalePrice.toFixed(2)} (${multiplier}x)`;
}

/**
 * Calculate prices based on wholesale price with tiered markup
 */
/**
 * Round a price UP to end in .97
 * Examples: $15.00 → $15.97, $15.98 → $16.97, $15.97 → $15.97
 */
function roundUpTo97(price: number): number {
  const dollars = Math.floor(price);
  const cents = Math.round((price - dollars) * 100);

  // If already .97, keep it
  if (cents === 97) {
    return price;
  }

  // If cents > 97, round up to next dollar + .97
  if (cents > 97) {
    return dollars + 1 + 0.97;
  }

  // Otherwise, round up to current dollar + .97
  return dollars + 0.97;
}

/**
 * Round a price to nearest ending in .67, .77, .87, or .97
 * Rounds DOWN to maintain discount perception
 * Examples: $14.37 → $13.97, $14.70 → $14.67, $14.80 → $14.77
 */
function roundToSevenEnding(price: number): number {
  const dollars = Math.floor(price);
  const cents = Math.round((price - dollars) * 100);

  // Available endings: 67, 77, 87, 97
  const endings = [67, 77, 87, 97];

  // Find the largest ending that doesn't exceed our price
  let bestEnding = 97; // default to previous dollar + .97
  let bestDollars = dollars - 1;

  for (const ending of endings) {
    if (ending <= cents) {
      bestEnding = ending;
      bestDollars = dollars;
    }
  }

  // If no ending fits in current dollar, use previous dollar's .97
  if (bestDollars < dollars - 1) {
    bestDollars = dollars - 1;
    bestEnding = 97;
  }

  // Ensure we don't go below $0.67
  if (bestDollars < 0) {
    return 0.67;
  }

  return bestDollars + bestEnding / 100;
}

function calculatePrices(wholesalePrice: number): { regular: number; sale: number; multiplier: number } {
  const multiplier = getMarkupMultiplier(wholesalePrice);

  // Calculate base prices
  const baseRegular = wholesalePrice * multiplier;
  const baseSale = baseRegular * (1 - SALE_DISCOUNT_PERCENT / 100);

  // Apply psychological pricing
  const regular = roundUpTo97(baseRegular);
  const sale = roundToSevenEnding(baseSale);

  return { regular, sale, multiplier };
}

/**
 * Load XML products and create lookup maps by SKU and barcode
 */
async function loadXMLProducts(): Promise<Map<string, XMLProduct>> {
  const xmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  console.log(`Loading products from: ${xmlPath}`);

  const parser = new XMLParser(xmlPath);
  const products = await parser.parseProducts();
  console.log(`Parsed ${products.length} products from XML\n`);

  // Create lookup map by SKU and barcode
  const productMap = new Map<string, XMLProduct>();
  for (const product of products) {
    if (product.sku) {
      productMap.set(product.sku.toUpperCase(), product);
    }
    if (product.barcode && product.barcode !== product.sku) {
      productMap.set(product.barcode.toUpperCase(), product);
    }
  }

  return productMap;
}

/**
 * Main price updater class
 */
class PriceUpdater {
  private connection: mysql.Connection | null = null;
  private xmlProducts: Map<string, XMLProduct>;
  private stats: PriceStats = {
    total: 0,
    matched: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    byRange: {
      under5: 0,
      range5to10: 0,
      range10to25: 0,
      range25to50: 0,
      range50to100: 0,
      over100: 0,
    },
    multiplierSum: 0,
    multiplierCount: 0,
  };

  constructor(xmlProducts: Map<string, XMLProduct>) {
    this.xmlProducts = xmlProducts;
  }

  async connect(): Promise<void> {
    this.connection = await getConnection();
    console.log('Connected to Local MySQL database\n');
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Get all products and variations with their current prices
   */
  async getProductPrices(limit?: number): Promise<ProductPrice[]> {
    if (!this.connection) throw new Error('Not connected');

    const limitClause = limit ? `LIMIT ${limit}` : '';

    const [rows] = await this.connection.execute(`
      SELECT
        p.ID as postId,
        p.post_type as postType,
        p.post_parent as parentId,
        p.post_title as productTitle,
        MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku,
        MAX(CASE WHEN pm.meta_key = '_wt_barcode' THEN pm.meta_value END) as barcode,
        MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) as currentRegularPrice,
        MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) as currentSalePrice,
        MAX(CASE WHEN pm.meta_key = '_price' THEN pm.meta_value END) as currentPrice
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
        AND pm.meta_key IN ('_sku', '_wt_barcode', '_regular_price', '_sale_price', '_price')
      WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status IN ('publish', 'draft')
      GROUP BY p.ID, p.post_type, p.post_parent, p.post_title
      ORDER BY p.ID
      ${limitClause}
    `);

    return (rows as any[]).map(row => ({
      postId: row.postId,
      postType: row.postType,
      parentId: row.parentId || null,
      sku: row.sku || '',
      barcode: row.barcode || '',
      currentRegularPrice: row.currentRegularPrice || '',
      currentSalePrice: row.currentSalePrice || '',
      currentPrice: row.currentPrice || '',
      productTitle: row.productTitle || '',
    }));
  }

  /**
   * Find XML product by SKU or barcode
   */
  findXMLProduct(product: ProductPrice): XMLProduct | null {
    // Try SKU first
    if (product.sku) {
      const bysku = this.xmlProducts.get(product.sku.toUpperCase());
      if (bysku) return bysku;
    }

    // Try barcode
    if (product.barcode) {
      const byBarcode = this.xmlProducts.get(product.barcode.toUpperCase());
      if (byBarcode) return byBarcode;
    }

    return null;
  }

  /**
   * Track price range statistics
   */
  private trackPriceRange(wholesalePrice: number, multiplier: number): void {
    // Track price ranges
    if (wholesalePrice <= 5) this.stats.byRange.under5++;
    else if (wholesalePrice <= 10) this.stats.byRange.range5to10++;
    else if (wholesalePrice <= 25) this.stats.byRange.range10to25++;
    else if (wholesalePrice <= 50) this.stats.byRange.range25to50++;
    else if (wholesalePrice <= 100) this.stats.byRange.range50to100++;
    else this.stats.byRange.over100++;

    // Track multiplier average
    this.stats.multiplierSum += multiplier;
    this.stats.multiplierCount++;
  }

  /**
   * Calculate price updates for all products
   */
  async calculateUpdates(limit?: number): Promise<PriceUpdate[]> {
    const products = await this.getProductPrices(limit);
    const updates: PriceUpdate[] = [];

    this.stats.total = products.length;

    for (const product of products) {
      const xmlProduct = this.findXMLProduct(product);

      if (!xmlProduct) {
        this.stats.skipped++;
        continue;
      }

      this.stats.matched++;

      const wholesalePrice = parseFloat(xmlProduct.price) || 0;
      if (wholesalePrice <= 0) {
        this.stats.skipped++;
        continue;
      }

      const { regular, sale, multiplier } = calculatePrices(wholesalePrice);
      const currentRegular = parseFloat(product.currentRegularPrice) || 0;
      const currentSale = parseFloat(product.currentSalePrice) || 0;

      // Track price range statistics
      this.trackPriceRange(wholesalePrice, multiplier);

      // Check if prices need updating (with small tolerance for floating point)
      const regularChanged = Math.abs(currentRegular - regular) > 0.01;
      const saleChanged = Math.abs(currentSale - sale) > 0.01;

      if (regularChanged || saleChanged) {
        updates.push({
          postId: product.postId,
          productTitle: product.productTitle || `Variation of #${product.parentId}`,
          sku: product.sku || product.barcode,
          postType: product.postType,
          wholesalePrice,
          currentRegularPrice: currentRegular,
          newRegularPrice: regular,
          currentSalePrice: currentSale,
          newSalePrice: sale,
          multiplier,
        });
      }
    }

    return updates;
  }

  /**
   * Apply price update to database
   */
  async applyUpdate(update: PriceUpdate): Promise<void> {
    if (!this.connection) throw new Error('Not connected');

    try {
      // Update _regular_price
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_regular_price'`,
        [update.newRegularPrice.toString(), update.postId]
      );

      // Update _sale_price
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_sale_price'`,
        [update.newSalePrice.toString(), update.postId]
      );

      // Update _price (WooCommerce uses this as the active price)
      await this.connection.execute(
        `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
        [update.newSalePrice.toString(), update.postId]
      );

      // Also update WooCommerce lookup table for better performance
      await this.connection.execute(
        `UPDATE wp_wc_product_meta_lookup
         SET min_price = ?, max_price = ?, onsale = 1
         WHERE product_id = ?`,
        [update.newSalePrice, update.newSalePrice, update.postId]
      );

      // Store wholesale price for reference in WooCommerce backend
      // First check if meta exists
      const [existing] = await this.connection.execute(
        `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wt_wholesale_price'`,
        [update.postId]
      );

      if ((existing as any[]).length > 0) {
        // Update existing
        await this.connection.execute(
          `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_wt_wholesale_price'`,
          [update.wholesalePrice.toString(), update.postId]
        );
      } else {
        // Insert new
        await this.connection.execute(
          `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wt_wholesale_price', ?)`,
          [update.postId, update.wholesalePrice.toString()]
        );
      }

      this.stats.updated++;
    } catch (error) {
      this.stats.errors.push({
        sku: update.sku,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Apply all updates
   */
  async applyUpdates(updates: PriceUpdate[]): Promise<void> {
    let progress = 0;
    const total = updates.length;

    for (const update of updates) {
      progress++;

      if (progress % 100 === 0 || progress === total) {
        process.stdout.write(`\rUpdating prices: ${progress}/${total}`);
      }

      await this.applyUpdate(update);
    }

    console.log('\n');
  }

  /**
   * Sync wholesale prices to _wt_wholesale_price meta field for all matched products
   */
  async syncWholesalePrices(limit?: number): Promise<number> {
    if (!this.connection) throw new Error('Not connected');

    const products = await this.getProductPrices(limit);
    let synced = 0;
    let progress = 0;
    const total = products.length;

    for (const product of products) {
      progress++;

      if (progress % 100 === 0 || progress === total) {
        process.stdout.write(`\rSyncing wholesale prices: ${progress}/${total} (${synced} updated)`);
      }

      const xmlProduct = this.findXMLProduct(product);
      if (!xmlProduct) continue;

      const wholesalePrice = parseFloat(xmlProduct.price) || 0;
      if (wholesalePrice <= 0) continue;

      try {
        // Check if meta exists
        const [existing] = await this.connection.execute(
          `SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wt_wholesale_price'`,
          [product.postId]
        );

        if ((existing as any[]).length > 0) {
          await this.connection.execute(
            `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_wt_wholesale_price'`,
            [wholesalePrice.toString(), product.postId]
          );
        } else {
          await this.connection.execute(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wt_wholesale_price', ?)`,
            [product.postId, wholesalePrice.toString()]
          );
        }
        synced++;
      } catch (error) {
        // Skip errors silently
      }
    }

    console.log('\n');
    return synced;
  }

  getStats(): PriceStats {
    return this.stats;
  }
}

/**
 * Print price range statistics
 */
function printPriceStats(stats: PriceStats): void {
  const avgMultiplier = stats.multiplierCount > 0
    ? (stats.multiplierSum / stats.multiplierCount).toFixed(2)
    : 'N/A';

  console.log('\n=== PRICE RANGE DISTRIBUTION ===');
  console.log(`  ≤$5 (5.0x):           ${stats.byRange.under5} products`);
  console.log(`  $5-$10 (~4.5x):       ${stats.byRange.range5to10} products`);
  console.log(`  $10-$25 (~3.6x):      ${stats.byRange.range10to25} products`);
  console.log(`  $25-$50 (~2.9x):      ${stats.byRange.range25to50} products`);
  console.log(`  $50-$100 (~2.4x):     ${stats.byRange.range50to100} products`);
  console.log(`  >$100 (2.1x):         ${stats.byRange.over100} products`);
  console.log(`\n  Average multiplier: ${avgMultiplier}x`);
}

/**
 * Print multiplier curve sample
 */
function printMultiplierCurve(): void {
  console.log('\n=== PRICING CURVE (with psychological pricing) ===');
  console.log('  Regular prices end in .97, Sale prices end in .67/.77/.87/.97\n');
  const samplePrices = [1, 3, 5, 7, 10, 15, 20, 30, 40, 50, 75, 100, 150];
  for (const price of samplePrices) {
    const { regular, sale, multiplier } = calculatePrices(price);
    console.log(`  $${price.toString().padStart(3)} wholesale → ${multiplier.toFixed(2)}x → $${regular.toFixed(2)} regular → $${sale.toFixed(2)} sale`);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string; limit?: number } {
  const args = process.argv.slice(2);
  let command = '--analyze';
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--analyze' || arg === '--dry-run' || arg === '--apply' || arg === '--sync-wholesale') {
      command = arg;
    } else if (arg === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Price Update Script

Updates product prices using a smooth logarithmic markup curve.
Uses DIRECT MySQL connection for maximum speed.

Markup Curve (Logarithmic):
  ≤$5:     ${MAX_MULTIPLIER}x (maximum)
  $10:     ~${getMarkupMultiplier(10).toFixed(2)}x
  $25:     ~${getMarkupMultiplier(25).toFixed(2)}x
  $50:     ~${getMarkupMultiplier(50).toFixed(2)}x
  ≥$100:   ${MIN_MULTIPLIER}x (minimum)

Sale price is always 10% off regular price.

Usage:
  bun scripts/update-prices.ts [command] [options]

Commands:
  --analyze         Show summary of price changes (default)
  --dry-run         Show detailed changes for first 50 products
  --apply           Apply price updates to database
  --sync-wholesale  Store wholesale prices in _wt_wholesale_price meta field

Options:
  --limit <n>   Limit number of products to process
  --help, -h    Show this help message

Examples:
  bun scripts/update-prices.ts --analyze
  bun scripts/update-prices.ts --dry-run
  bun scripts/update-prices.ts --apply --limit 100
      `);
      process.exit(0);
    }
  }

  return { command, limit };
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  const { command, limit } = parseArgs();

  console.log('\n======================================');
  console.log('       PRICE UPDATE SCRIPT');
  console.log('======================================\n');

  console.log('Markup: Smooth logarithmic curve');
  console.log(`  Range: ${MAX_MULTIPLIER}x (at ≤$${MIN_PRICE}) → ${MIN_MULTIPLIER}x (at ≥$${MAX_PRICE})`);
  console.log(`  Sale Discount: ${SALE_DISCOUNT_PERCENT}%`);
  console.log('  Method: Direct MySQL (fast)\n');

  // Show the multiplier curve
  printMultiplierCurve();
  console.log('');

  // Load XML products
  const xmlProducts = await loadXMLProducts();

  // Create updater
  const updater = new PriceUpdater(xmlProducts);

  try {
    await updater.connect();

    // Calculate updates
    console.log('Calculating price updates...\n');
    const updates = await updater.calculateUpdates(limit);
    const stats = updater.getStats();

    if (command === '--analyze') {
      // Summary view
      console.log('=== ANALYSIS SUMMARY ===');
      console.log(`Total products in database: ${stats.total}`);
      console.log(`Matched with XML data: ${stats.matched}`);
      console.log(`Products needing price update: ${updates.length}`);
      console.log(`Skipped (no match/no price): ${stats.skipped}`);

      printPriceStats(stats);

      // Show sample of updates
      if (updates.length > 0) {
        console.log('\n=== SAMPLE UPDATES (first 10) ===');
        for (const update of updates.slice(0, 10)) {
          console.log(`\n[${update.postId}] ${update.productTitle.substring(0, 50)}`);
          console.log(`  SKU: ${update.sku} | Type: ${update.postType}`);
          console.log(`  Wholesale: $${update.wholesalePrice.toFixed(2)} | ${update.multiplier.toFixed(2)}x`);
          console.log(`  Regular: $${update.currentRegularPrice.toFixed(2)} -> $${update.newRegularPrice.toFixed(2)}`);
          console.log(`  Sale: $${update.currentSalePrice.toFixed(2)} -> $${update.newSalePrice.toFixed(2)}`);
        }
      }

      console.log('\n\nRun with --dry-run for detailed list, or --apply to update database.');

    } else if (command === '--dry-run') {
      // Detailed view
      console.log('=== DRY RUN - DETAILED CHANGES ===');
      console.log(`Showing first ${Math.min(50, updates.length)} of ${updates.length} updates:\n`);

      for (const update of updates.slice(0, 50)) {
        console.log(`[${update.postId}] ${update.productTitle.substring(0, 60)}`);
        console.log(`  SKU: ${update.sku} | Wholesale: $${update.wholesalePrice.toFixed(2)} | ${update.multiplier.toFixed(2)}x`);
        console.log(`  Regular: $${update.currentRegularPrice.toFixed(2)} -> $${update.newRegularPrice.toFixed(2)}`);
        console.log(`  Sale: $${update.currentSalePrice.toFixed(2)} -> $${update.newSalePrice.toFixed(2)}`);
        console.log('');
      }

      printPriceStats(stats);
      console.log('\nRun with --apply to update database.');

    } else if (command === '--apply') {
      // Apply updates
      console.log(`Applying ${updates.length} price updates...\n`);
      await updater.applyUpdates(updates);

      const finalStats = updater.getStats();

      console.log('=== UPDATE COMPLETE ===');
      console.log(`Total processed: ${finalStats.total}`);
      console.log(`Matched with XML: ${finalStats.matched}`);
      console.log(`Prices updated: ${finalStats.updated}`);
      console.log(`Errors: ${finalStats.errors.length}`);

      printPriceStats(finalStats);

      if (finalStats.errors.length > 0) {
        console.log('\nFirst 10 errors:');
        finalStats.errors.slice(0, 10).forEach(err => {
          console.log(`  - ${err.sku}: ${err.message}`);
        });
      }

      // Save report
      const report = {
        timestamp: new Date().toISOString(),
        duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        ...finalStats,
      };

      const reportPath = join(process.cwd(), 'data', 'price-update-report.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nReport saved to: ${reportPath}`);

    } else if (command === '--sync-wholesale') {
      // Sync wholesale prices to meta field
      console.log('Syncing wholesale prices to _wt_wholesale_price meta field...\n');
      const synced = await updater.syncWholesalePrices(limit);

      console.log('=== SYNC COMPLETE ===');
      console.log(`Wholesale prices synced: ${synced}`);
      console.log('\nYou can now view wholesale prices in WooCommerce product edit pages');
      console.log('under Custom Fields as "_wt_wholesale_price"');
    }

    const duration = Date.now() - startTime;
    console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);

  } finally {
    await updater.disconnect();
  }
}

main().catch(error => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
