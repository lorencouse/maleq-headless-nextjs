#!/usr/bin/env bun

/**
 * Product Import Script
 *
 * Imports products from Williams Trading XML into WooCommerce
 * Follows IMPORT_PARAMETERS.md specifications
 *
 * Usage:
 *   bun scripts/import-products.ts [options]
 *
 * Options:
 *   --limit <n>           Limit number of products to import (default: all)
 *   --no-variations       Disable variation detection
 *   --skip-manufacturers  Skip manufacturer import
 *   --skip-categories     Skip category import
 *   --skip-products       Skip product import (setup only)
 *   --skip-images         Skip image processing (faster import)
 *
 * Examples:
 *   bun scripts/import-products.ts --limit 50
 *   bun scripts/import-products.ts --no-variations
 *   bun scripts/import-products.ts --skip-images --limit 100
 */

import { join } from 'path';
import { ManufacturerImporter } from '../lib/import/manufacturer-importer';
import { CategoryImporter } from '../lib/import/category-importer';
import { ProductImporter } from '../lib/import/product-importer';
import { XMLParser } from '../lib/import/xml-parser';
import { wooClient } from '../lib/woocommerce/client';
import { writeFileSync } from 'fs';

interface ImportOptions {
  limit?: number;
  detectVariations: boolean;
  skipManufacturers: boolean;
  skipCategories: boolean;
  skipProducts: boolean;
  skipImages: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    detectVariations: true,
    skipManufacturers: false,
    skipCategories: false,
    skipProducts: false,
    skipImages: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--no-variations') {
      options.detectVariations = false;
    } else if (arg === '--skip-manufacturers') {
      options.skipManufacturers = true;
    } else if (arg === '--skip-categories') {
      options.skipCategories = true;
    } else if (arg === '--skip-products') {
      options.skipProducts = true;
    } else if (arg === '--skip-images') {
      options.skipImages = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Product Import Script

Usage:
  bun scripts/import-products.ts [options]

Options:
  --limit <n>           Limit number of products to import (default: all)
  --no-variations       Disable variation detection
  --skip-manufacturers  Skip manufacturer import
  --skip-categories     Skip category import
  --skip-products       Skip product import (setup only)
  --skip-images         Skip image processing (faster import)
  --help, -h            Show this help message

Examples:
  bun scripts/import-products.ts --limit 50
  bun scripts/import-products.ts --no-variations
  bun scripts/import-products.ts --skip-images --limit 100
  bun scripts/import-products.ts --skip-products  # Setup taxonomies only
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Generate import report
 */
function generateReport(results: {
  manufacturers?: any;
  categories?: any;
  products?: any;
  duration: number;
}): void {
  const report = {
    timestamp: new Date().toISOString(),
    duration: `${(results.duration / 1000).toFixed(2)}s`,
    manufacturers: results.manufacturers || null,
    categories: results.categories || null,
    products: results.products || null,
  };

  const reportPath = join(process.cwd(), 'data', 'import-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Duration: ${report.duration}`);
  console.log(`Report saved to: ${reportPath}\n`);
}

/**
 * Main import function
 */
async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   WooCommerce Product Import Script   ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Variation Detection: ${options.detectVariations ? 'Enabled' : 'Disabled'}`);
  console.log(`  Image Processing: ${options.skipImages ? 'Disabled' : 'Enabled'}`);
  if (options.limit) {
    console.log(`  Product Limit: ${options.limit}`);
  }
  console.log();

  // Test WooCommerce connection
  console.log('Testing WooCommerce connection...');
  const connected = await wooClient.testConnection();

  if (!connected) {
    console.error('✗ Failed to connect to WooCommerce API');
    console.error('Please check your .env.local configuration:');
    console.error('  - WOOCOMMERCE_URL');
    console.error('  - WOOCOMMERCE_CONSUMER_KEY');
    console.error('  - WOOCOMMERCE_CONSUMER_SECRET');
    process.exit(1);
  }

  console.log('✓ Connected to WooCommerce\n');

  const results: any = {};

  // Step 1: Import Manufacturers
  if (!options.skipManufacturers) {
    const manufacturerImporter = new ManufacturerImporter();
    try {
      results.manufacturers = await manufacturerImporter.importManufacturers();
    } catch (error) {
      console.error('✗ Manufacturer import failed:', error);
      console.error('Note: Manufacturer taxonomy may need to be registered in WordPress');
      console.error('Continuing without manufacturer taxonomy...\n');
    }
  } else {
    console.log('Skipping manufacturer import\n');
  }

  // Step 2: Parse XML and import categories
  const xmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  console.log(`Loading products from: ${xmlPath}`);

  const parser = new XMLParser(xmlPath);
  const products = await parser.parseProducts();

  console.log(`✓ Parsed ${products.length} products from XML\n`);

  if (!options.skipCategories) {
    const categoryImporter = new CategoryImporter();
    const categories = categoryImporter.extractCategories(products);
    results.categories = await categoryImporter.importCategories(categories);
  } else {
    console.log('Skipping category import\n');
  }

  // Step 3: Import Products
  if (!options.skipProducts) {
    const categoryImporter = new CategoryImporter();
    const manufacturerImporter = new ManufacturerImporter();
    const productImporter = new ProductImporter(
      {
        priceMultiplier: 3,
        saleDiscountPercent: 10,
        baseImageUrl: 'https://images.williams-trading.com',
        skipImages: options.skipImages,
      },
      categoryImporter,
      manufacturerImporter
    );

    await productImporter.init();

    results.products = await productImporter.importProducts(products, {
      detectVariations: options.detectVariations,
      limit: options.limit,
    });

    // Print product summary
    console.log('\n=== PRODUCT IMPORT SUMMARY ===');
    console.log(`Processed: ${results.products.processed}`);
    console.log(`Created: ${results.products.created}`);
    console.log(`  - Simple Products: ${results.products.simpleProducts}`);
    console.log(`  - Variable Products: ${results.products.variableProducts}`);
    console.log(`Skipped: ${results.products.skipped}`);
    console.log(`Errors: ${results.products.errors.length}`);

    if (results.products.errors.length > 0) {
      console.log('\nErrors:');
      results.products.errors.slice(0, 10).forEach((err: any) => {
        console.log(`  - ${err.sku}: ${err.message}`);
      });

      if (results.products.errors.length > 10) {
        console.log(`  ... and ${results.products.errors.length - 10} more errors`);
      }
    }
  } else {
    console.log('Skipping product import (setup only)\n');
  }

  // Generate report
  const duration = Date.now() - startTime;
  generateReport({ ...results, duration });

  console.log('✓ Import completed successfully');
  process.exit(0);
}

// Run import
main().catch(error => {
  console.error('\n✗ Import failed with error:');
  console.error(error);
  process.exit(1);
});
