#!/usr/bin/env bun

/**
 * Image Import Script
 *
 * Retroactively adds images to existing products that were imported without images.
 * Matches products by SKU/barcode and uploads images.
 *
 * Usage:
 *   bun scripts/import-images.ts [options]
 *
 * Options:
 *   --limit <n>     Limit number of products to process (default: all)
 *   --batch <n>     Batch size for processing (default: 10)
 *   --skip-existing Skip products that already have images
 *
 * Examples:
 *   bun scripts/import-images.ts --limit 100
 *   bun scripts/import-images.ts --skip-existing
 */

import { join } from 'path';
import { XMLParser } from '../lib/import/xml-parser';
import { ImageProcessor } from '../lib/import/image-processor';
import { wooClient } from '../lib/woocommerce/client';

interface ImageImportOptions {
  limit?: number;
  batchSize: number;
  skipExisting: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImageImportOptions {
  const args = process.argv.slice(2);
  const options: ImageImportOptions = {
    batchSize: 10,
    skipExisting: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--batch' && i + 1 < args.length) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Image Import Script

Usage:
  bun scripts/import-images.ts [options]

Options:
  --limit <n>        Limit number of products to process (default: all)
  --batch <n>        Batch size for processing (default: 10)
  --skip-existing    Skip products that already have images
  --help, -h         Show this help message

Examples:
  bun scripts/import-images.ts --limit 100
  bun scripts/import-images.ts --skip-existing --batch 20
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Main import function
 */
async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Product Image Import Script         ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Batch Size: ${options.batchSize}`);
  console.log(`  Skip Existing: ${options.skipExisting ? 'Yes' : 'No'}`);
  if (options.limit) {
    console.log(`  Product Limit: ${options.limit}`);
  }
  console.log();

  // Test WooCommerce connection
  console.log('Testing WooCommerce connection...');
  const connected = await wooClient.testConnection();

  if (!connected) {
    console.error('✗ Failed to connect to WooCommerce API');
    process.exit(1);
  }

  console.log('✓ Connected to WooCommerce\n');

  // Parse XML file
  const xmlPath = join(process.cwd(), 'data', 'products-filtered.xml');
  console.log(`Loading products from: ${xmlPath}`);

  const parser = new XMLParser(xmlPath);
  const xmlProducts = await parser.parseProducts();

  console.log(`✓ Parsed ${xmlProducts.length} products from XML\n`);

  // Create SKU to XML product mapping
  const skuMap = new Map<string, typeof xmlProducts[0]>();
  for (const product of xmlProducts) {
    if (product.barcode) {
      skuMap.set(product.barcode, product);
    }
  }

  // Initialize image processor
  const imageProcessor = new ImageProcessor();
  await imageProcessor.init();

  console.log('=== FETCHING WOOCOMMERCE PRODUCTS ===\n');

  // Fetch all products from WooCommerce
  let page = 1;
  let allWooProducts: any[] = [];

  while (true) {
    const products = await wooClient.getProducts({ per_page: 100, page });
    if (products.length === 0) break;
    allWooProducts.push(...products);
    console.log(`Fetched page ${page}: ${products.length} products`);
    page++;
  }

  console.log(`\n✓ Total products in WooCommerce: ${allWooProducts.length}\n`);

  // Filter products that need images
  const productsToProcess = allWooProducts.filter(product => {
    if (options.skipExisting && product.images && product.images.length > 0) {
      return false;
    }
    return true;
  });

  console.log(`Products needing images: ${productsToProcess.length}\n`);

  if (options.limit) {
    productsToProcess.splice(options.limit);
  }

  console.log('=== PROCESSING IMAGES ===\n');

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors: Array<{ id: number; name: string; error: string }> = [];

  // Process in batches
  for (let i = 0; i < productsToProcess.length; i += options.batchSize) {
    const batch = productsToProcess.slice(i, i + options.batchSize);

    await Promise.all(
      batch.map(async (wooProduct) => {
        try {
          processed++;
          console.log(`\n[${processed}/${productsToProcess.length}] Processing: ${wooProduct.name}`);

          // Handle variable products
          if (wooProduct.type === 'variable') {
            console.log('  Variable product - processing variations...');

            // Fetch variations
            const variations = await wooClient.getVariations(wooProduct.id);
            console.log(`  Found ${variations.length} variations`);

            for (const variation of variations) {
              const xmlProduct = skuMap.get(variation.sku);

              if (!xmlProduct) {
                console.log(`  ⚠ No XML data found for SKU: ${variation.sku}`);
                continue;
              }

              if (xmlProduct.images.length === 0) {
                console.log(`  ⊕ No images in XML for: ${variation.sku}`);
                continue;
              }

              // Process and upload images
              console.log(`  Processing ${xmlProduct.images.length} images for variation ${variation.id}...`);
              const uploadedImages = await imageProcessor.processAndUploadImages(
                xmlProduct.images,
                xmlProduct.name,
                'https://images.williams-trading.com'
              );

              if (uploadedImages.length > 0) {
                // Update variation with first image
                await wooClient.updateVariation(wooProduct.id, variation.id, {
                  image: {
                    id: uploadedImages[0].mediaId,
                    src: uploadedImages[0].url,
                  },
                });
                console.log(`  ✓ Updated variation ${variation.id} with ${uploadedImages.length} images`);
              }
            }

            updated++;
          } else {
            // Handle simple products
            const xmlProduct = skuMap.get(wooProduct.sku);

            if (!xmlProduct) {
              console.log(`  ⊕ No XML data found for SKU: ${wooProduct.sku}`);
              skipped++;
              return;
            }

            if (xmlProduct.images.length === 0) {
              console.log(`  ⊕ No images in XML`);
              skipped++;
              return;
            }

            // Process and upload images
            console.log(`  Processing ${xmlProduct.images.length} images...`);
            const uploadedImages = await imageProcessor.processAndUploadImages(
              xmlProduct.images,
              xmlProduct.name,
              'https://images.williams-trading.com'
            );

            if (uploadedImages.length > 0) {
              // Update product with images
              await wooClient.updateProduct(wooProduct.id, {
                images: uploadedImages.map((img, index) => ({
                  id: img.mediaId,
                  src: img.url,
                  position: index,
                })),
              });
              console.log(`  ✓ Updated with ${uploadedImages.length} images`);
              updated++;
            } else {
              console.log(`  ⚠ No images uploaded`);
              skipped++;
            }
          }
        } catch (error) {
          console.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          errors.push({
            id: wooProduct.id,
            name: wooProduct.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })
    );
  }

  const duration = Date.now() - startTime;

  console.log('\n=== IMAGE IMPORT SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.slice(0, 10).forEach((err) => {
      console.log(`  - ${err.name} (ID: ${err.id}): ${err.error}`);
    });

    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Duration: ${(duration / 1000).toFixed(2)}s\n`);

  process.exit(0);
}

// Run import
main().catch((error) => {
  console.error('\n✗ Import failed with error:');
  console.error(error);
  process.exit(1);
});
