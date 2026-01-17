import { williamsTradingClient } from './client';
import { wooClient } from '@/lib/woocommerce/client';
import {
  transformWTProductToWoo,
  transformWTCategoryToWoo,
  transformWTManufacturerToTerm,
  transformWTImagesToWoo,
  prepareProductUpdate,
} from '@/lib/woocommerce/transformer';
import type { WooProduct, WooCategory, WooProductImage } from '@/lib/woocommerce/types';
import type { CategoryHierarchy, CategoryMapping, CategorySyncStats, SourceCategory } from './types';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export class WilliamsTradingSyncService {
  // Cache for category and manufacturer mappings
  private categoryMap: Map<string, number> = new Map(); // WT code -> WooCommerce ID
  private manufacturerMap: Map<string, number> = new Map(); // WT code -> WooCommerce term ID
  private skuToWooIdMap: Map<string, number> = new Map(); // SKU -> WooCommerce product ID

  /**
   * Log sync operation (simple console logging)
   */
  private logSync(
    operation: string,
    data: {
      status: 'started' | 'completed' | 'failed';
      recordsTotal?: number;
      recordsAdded?: number;
      recordsUpdated?: number;
      recordsFailed?: number;
      errorMessage?: string;
    }
  ) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      operation,
      ...data,
    };
    console.log(`[SYNC ${data.status.toUpperCase()}]`, JSON.stringify(logEntry, null, 2));
  }

  /**
   * Build category map from WooCommerce
   */
  private async buildCategoryMap(): Promise<void> {
    const categories = await wooClient.getCategories();
    this.categoryMap.clear();

    for (const cat of categories) {
      if (cat.slug && cat.id) {
        // Map by slug (which we created from WT code)
        this.categoryMap.set(cat.slug.toUpperCase().replace(/-/g, '_'), cat.id);
      }
    }
  }

  /**
   * Build manufacturer map from WooCommerce
   */
  private async buildManufacturerMap(): Promise<void> {
    try {
      const manufacturers = await wooClient.getManufacturers();
      this.manufacturerMap.clear();

      for (const mfr of manufacturers) {
        if (mfr.slug && mfr.id) {
          this.manufacturerMap.set(mfr.slug.toUpperCase().replace(/-/g, '_'), mfr.id);
        }
      }
    } catch (error) {
      console.warn('Could not load manufacturers from WooCommerce:', error);
    }
  }

  /**
   * Build SKU to WooCommerce ID map
   */
  private async buildSkuMap(): Promise<void> {
    this.skuToWooIdMap.clear();
    let page = 1;
    const perPage = 100;

    while (true) {
      const products = await wooClient.getProducts({ per_page: perPage, page });
      if (products.length === 0) break;

      for (const product of products) {
        if (product.sku && product.id) {
          this.skuToWooIdMap.set(product.sku, product.id);
        }
      }

      if (products.length < perPage) break;
      page++;
    }

    console.log(`Built SKU map with ${this.skuToWooIdMap.size} products`);
  }

  /**
   * Load category hierarchy from JSON file
   */
  private loadCategoryHierarchy(): CategoryHierarchy {
    const hierarchyPath = join(process.cwd(), 'data', 'category-hierarchy.json');
    if (!existsSync(hierarchyPath)) {
      throw new Error(
        'Category hierarchy file not found. Run: bun scripts/build-category-hierarchy.ts'
      );
    }
    const rawData = readFileSync(hierarchyPath, 'utf-8');
    return JSON.parse(rawData) as CategoryHierarchy;
  }

  /**
   * Load category mapping from JSON file (if exists)
   */
  private loadCategoryMapping(): CategoryMapping {
    const mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
    if (!existsSync(mappingPath)) {
      return {
        codeToId: {},
        idToCode: {},
        lastSynced: '',
        totalMapped: 0,
      };
    }
    const rawData = readFileSync(mappingPath, 'utf-8');
    return JSON.parse(rawData) as CategoryMapping;
  }

  /**
   * Save category mapping to JSON file
   */
  private saveCategoryMapping(mapping: CategoryMapping): void {
    const mappingPath = join(process.cwd(), 'data', 'category-mapping.json');
    mapping.lastSynced = new Date().toISOString();
    mapping.totalMapped = Object.keys(mapping.codeToId).length;
    writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
    console.log(`💾 Saved category mapping: ${mapping.totalMapped} categories`);
  }

  /**
   * Sync categories from Williams Trading to WooCommerce
   */
  async syncCategories(): Promise<{ added: number; updated: number; failed: number }> {
    let added = 0;
    let updated = 0;
    let failed = 0;

    this.logSync('CATEGORIES', { status: 'started' });

    try {
      console.log('Fetching product types from Williams Trading...');
      const productTypes = await williamsTradingClient.getProductTypes({ active: '1' });
      console.log(`Found ${productTypes.length} product types`);

      // Get existing WooCommerce categories
      const existingCategories = await wooClient.getCategories();
      const existingBySlug = new Map(existingCategories.map(c => [c.slug, c]));

      // First pass: create/update categories without parents
      const createdCategories = new Map<string, WooCategory>();

      for (const wtType of productTypes) {
        try {
          const wooCategory = transformWTCategoryToWoo(wtType);
          const existing = existingBySlug.get(wooCategory.slug);

          if (existing) {
            // Update existing
            await wooClient.updateCategory(existing.id!, {
              name: wooCategory.name,
              description: wooCategory.description,
            });
            createdCategories.set(wtType.code, { ...existing, ...wooCategory });
            updated++;
          } else {
            // Create new
            const created = await wooClient.createCategory(wooCategory);
            createdCategories.set(wtType.code, created);
            added++;
          }
        } catch (error) {
          console.error(`Failed to sync category ${wtType.code}:`, error);
          failed++;
        }
      }

      // Second pass: set parent relationships
      for (const wtType of productTypes) {
        if (wtType.parent_code) {
          try {
            const category = createdCategories.get(wtType.code);
            const parentCategory = createdCategories.get(wtType.parent_code);

            if (category?.id && parentCategory?.id && category.parent !== parentCategory.id) {
              await wooClient.updateCategory(category.id, { parent: parentCategory.id });
            }
          } catch (error) {
            console.error(`Failed to set parent for category ${wtType.code}:`, error);
          }
        }
      }

      // Rebuild category map
      await this.buildCategoryMap();

      this.logSync('CATEGORIES', {
        status: 'completed',
        recordsTotal: productTypes.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Categories sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('CATEGORIES', {
        status: 'failed',
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Sync full category hierarchy from JSON file to WooCommerce
   * This syncs all 227 categories with their parent-child relationships
   */
  async syncCategoryHierarchy(): Promise<CategorySyncStats> {
    const startTime = Date.now();

    const stats: CategorySyncStats = {
      totalCategories: 0,
      created: 0,
      updated: 0,
      failed: 0,
      byLevel: {},
    };

    this.logSync('CATEGORY_HIERARCHY', { status: 'started' });

    try {
      console.log('📂 Loading category hierarchy...');
      const hierarchy = this.loadCategoryHierarchy();
      const mapping = this.loadCategoryMapping();

      stats.totalCategories = hierarchy.totalCategories;
      console.log(`✅ Loaded ${hierarchy.totalCategories} categories (${hierarchy.maxLevel + 1} levels)`);

      // Get existing WooCommerce categories
      console.log('🔍 Fetching existing WooCommerce categories...');
      const existingCategories = await wooClient.getCategories();
      const existingBySlug = new Map(existingCategories.map(c => [c.slug, c]));
      console.log(`✅ Found ${existingCategories.length} existing categories`);

      // Track used slugs to handle duplicates
      const usedSlugs = new Set(existingCategories.map(c => c.slug));

      // Sync level by level
      for (let level = 0; level <= hierarchy.maxLevel; level++) {
        const levelCategories = hierarchy.levels[level.toString()] || [];
        console.log(`\n📊 Processing Level ${level}: ${levelCategories.length} categories`);

        stats.byLevel[level] = { created: 0, updated: 0, failed: 0 };

        for (const category of levelCategories) {
          try {
            // Generate SEO-friendly slug from category name
            let slug = category.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');

            // If slug is already used (duplicate name), append the category code
            if (usedSlugs.has(slug)) {
              slug = `${slug}-${category.code}`;
            }
            usedSlugs.add(slug);

            // Get parent WooCommerce ID from mapping (if not top-level)
            let parentId = 0;
            if (category.parent !== '0') {
              parentId = mapping.codeToId[category.parent];
              if (!parentId) {
                console.warn(`⚠️  Parent ${category.parent} not found for category ${category.code}`);
              }
            }

            // Check if category exists
            const existing = existingBySlug.get(slug);

            if (existing) {
              // Update existing category
              await wooClient.updateCategory(existing.id!, {
                name: category.name,
                parent: parentId,
              });

              mapping.codeToId[category.code] = existing.id!;
              mapping.idToCode[existing.id!.toString()] = category.code;
              stats.updated++;
              stats.byLevel[level].updated++;

              console.log(`  ✏️  Updated: [${category.code}] ${category.name}`);
            } else {
              // Create new category
              const created = await wooClient.createCategory({
                name: category.name,
                slug: slug,
                parent: parentId,
                description: '',
              });

              mapping.codeToId[category.code] = created.id!;
              mapping.idToCode[created.id!.toString()] = category.code;
              stats.created++;
              stats.byLevel[level].created++;

              console.log(`  ➕ Created: [${category.code}] ${category.name}`);
            }

            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`  ❌ Failed: [${category.code}] ${category.name}:`, error);
            stats.failed++;
            stats.byLevel[level].failed++;
          }
        }

        console.log(`  Level ${level} complete: ${stats.byLevel[level].created} created, ${stats.byLevel[level].updated} updated, ${stats.byLevel[level].failed} failed`);
      }

      // Save mapping to file
      this.saveCategoryMapping(mapping);

      // Log completion
      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logSync('CATEGORY_HIERARCHY', {
        status: 'completed',
        recordsTotal: stats.totalCategories,
        recordsAdded: stats.created,
        recordsUpdated: stats.updated,
        recordsFailed: stats.failed,
      });

      console.log(`\n✅ Category hierarchy sync completed in ${duration}s`);
      console.log(`   Total: ${stats.totalCategories} | Created: ${stats.created} | Updated: ${stats.updated} | Failed: ${stats.failed}`);

      return stats;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('CATEGORY_HIERARCHY', {
        status: 'failed',
        errorMessage,
      });
      console.error('❌ Category hierarchy sync failed:', error);
      throw error;
    }
  }

  /**
   * Sync manufacturers from Williams Trading to WooCommerce
   * Note: Requires manufacturer custom taxonomy to be registered in WordPress
   */
  async syncManufacturers(): Promise<{ added: number; updated: number; failed: number }> {
    let added = 0;
    let updated = 0;
    let failed = 0;

    this.logSync('MANUFACTURERS', { status: 'started' });

    try {
      console.log('Fetching manufacturers from Williams Trading...');
      const manufacturers = await williamsTradingClient.getManufacturers({ active: '1' });
      console.log(`Found ${manufacturers.length} manufacturers`);

      // Get existing manufacturers from WooCommerce
      let existingManufacturers: { id?: number; slug?: string; name: string }[] = [];
      try {
        existingManufacturers = await wooClient.getManufacturers();
      } catch {
        console.warn('Manufacturer taxonomy may not be registered in WordPress');
      }

      const existingBySlug = new Map(existingManufacturers.map(m => [m.slug, m]));

      for (const wtMfr of manufacturers) {
        try {
          const term = transformWTManufacturerToTerm(wtMfr);
          const existing = existingBySlug.get(term.slug);

          if (existing) {
            await wooClient.updateManufacturer(existing.id!, {
              name: term.name,
              description: term.description,
            });
            updated++;
          } else {
            await wooClient.createManufacturer({
              name: term.name,
              slug: term.slug,
              description: term.description,
            });
            added++;
          }
        } catch (error) {
          console.error(`Failed to sync manufacturer ${wtMfr.code}:`, error);
          failed++;
        }
      }

      // Rebuild manufacturer map
      await this.buildManufacturerMap();

      this.logSync('MANUFACTURERS', {
        status: 'completed',
        recordsTotal: manufacturers.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Manufacturers sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('MANUFACTURERS', {
        status: 'failed',
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Upload product images to WordPress media library
   */
  private async uploadProductImages(
    sku: string,
    productName: string
  ): Promise<WooProductImage[]> {
    const images: WooProductImage[] = [];

    try {
      console.log(`    Fetching image list from Williams Trading API for ${sku}...`);
      const wtImages = await williamsTradingClient.getProductImages(sku);
      if (wtImages.length === 0) {
        console.log(`    No images found for ${sku}`);
        return images;
      }
      console.log(`    Found ${wtImages.length} images`);

      // Sort images: primary first, then by sort order
      wtImages.sort((a, b) => {
        if (a.is_primary === '1' && b.is_primary !== '1') return -1;
        if (b.is_primary === '1' && a.is_primary !== '1') return 1;
        const orderA = typeof a.sort_order === 'string' ? parseInt(a.sort_order, 10) : a.sort_order;
        const orderB = typeof b.sort_order === 'string' ? parseInt(b.sort_order, 10) : b.sort_order;
        return orderA - orderB;
      });

      for (let i = 0; i < wtImages.length; i++) {
        const wtImage = wtImages[i];
        try {
          const imageUrl = williamsTradingClient.getImageUrl(wtImage.image_url, sku, 'large');
          console.log(`    [Image ${i + 1}/${wtImages.length}] ${wtImage.file_name}`);
          console.log(`      URL: ${imageUrl}`);

          // Check if image already exists in media library
          console.log(`      Checking if image exists in media library...`);
          let mediaItem = await wooClient.getMediaByFilename(wtImage.file_name);

          if (!mediaItem) {
            console.log(`      Uploading to WordPress media library...`);
            // Upload new image
            mediaItem = await wooClient.uploadImage(
              imageUrl,
              wtImage.file_name,
              productName
            );
            console.log(`      ✓ Uploaded (Media ID: ${mediaItem?.id})`);
          } else {
            console.log(`      ⊘ Already exists (Media ID: ${mediaItem.id})`);
          }

          if (mediaItem?.id) {
            images.push({
              id: mediaItem.id,
              src: mediaItem.src,
              alt: productName,
              position: images.length,
            });
          }
        } catch (error) {
          console.error(`      ❌ Failed to upload image ${wtImage.file_name}:`, error);
          // Continue with other images
        }

        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`    ❌ Failed to fetch images for ${sku}:`, error);
    }

    console.log(`    Total images processed: ${images.length}`);
    return images;
  }

  /**
   * Sync products from Williams Trading to WooCommerce
   */
  async syncProducts(
    options: { activeOnly?: boolean; limit?: number; uploadImages?: boolean } = {}
  ): Promise<{ added: number; updated: number; failed: number }> {
    const { activeOnly = true, limit, uploadImages = true } = options;
    let added = 0;
    let updated = 0;
    let failed = 0;

    this.logSync('PRODUCTS', { status: 'started' });

    try {
      // Ensure we have category and manufacturer maps
      if (this.categoryMap.size === 0) {
        await this.buildCategoryMap();
      }
      if (this.manufacturerMap.size === 0) {
        await this.buildManufacturerMap();
      }

      // Build SKU map for efficient lookups
      await this.buildSkuMap();

      console.log('Fetching products from Williams Trading...');
      const params = limit ? { count: limit } : {};
      const wtProducts = activeOnly
        ? await williamsTradingClient.getActiveProducts(params)
        : await williamsTradingClient.getProducts(params);

      console.log(`Found ${wtProducts.length} products`);

      for (let i = 0; i < wtProducts.length; i++) {
        const wtProduct = wtProducts[i];
        try {
          console.log(`\n[Product ${i + 1}/${wtProducts.length}] Processing ${wtProduct.sku}...`);

          // Skip products without SKU
          if (!wtProduct.sku) {
            console.warn('⚠️  Skipping product without SKU');
            failed++;
            continue;
          }

          // Upload images if enabled
          let images: WooProductImage[] = [];
          if (uploadImages) {
            console.log(`  Fetching images for ${wtProduct.sku}...`);
            images = await this.uploadProductImages(wtProduct.sku, wtProduct.name);
            console.log(`  Found ${images.length} images`);
          }

          // Transform to WooCommerce format
          const wooProduct = transformWTProductToWoo(
            wtProduct,
            this.categoryMap,
            this.manufacturerMap,
            images
          );

          // Check if product already exists in WooCommerce
          // Use UPC code as SKU (matching transformer)
          const productSku = wtProduct.upc_code || wtProduct.sku;
          const existingId = this.skuToWooIdMap.get(productSku);

          if (existingId) {
            console.log(`  Product exists (ID: ${existingId}), checking for updates...`);
            // Get existing product to compare
            const existing = await wooClient.getProductById(existingId);

            // Only update if there are changes
            const updates = prepareProductUpdate(existing, wooProduct);
            if (updates) {
              console.log(`  Updating product...`);
              await wooClient.updateProduct(existingId, updates);
              updated++;
              console.log(`  ✓ Updated`);
            } else {
              // No changes needed, still count as processed
              console.log(`  ⊘ No changes needed, skipping`);
            }
          } else {
            console.log(`  Creating new product...`);
            // Create new product
            const created = await wooClient.createProduct(wooProduct);
            if (created.id) {
              this.skuToWooIdMap.set(productSku, created.id);
              console.log(`  ✓ Created (ID: ${created.id})`);
            }
            added++;
          }
        } catch (error) {
          console.error(`  ❌ Failed to sync product ${wtProduct.sku}:`, error);
          failed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.logSync('PRODUCTS', {
        status: 'completed',
        recordsTotal: wtProducts.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Products sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('PRODUCTS', {
        status: 'failed',
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Update stock quantities only (for frequent updates)
   */
  async updateStock(): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    this.logSync('STOCK_UPDATE', { status: 'started' });

    try {
      // Build SKU map if not already built
      if (this.skuToWooIdMap.size === 0) {
        await this.buildSkuMap();
      }

      console.log('Fetching stock from Williams Trading...');
      const wtProducts = await williamsTradingClient.getActiveProducts();
      console.log(`Updating stock for ${wtProducts.length} products`);

      // Batch stock updates for efficiency
      const batchSize = 100;
      const stockUpdates: { id: number; stock_quantity: number; stock_status: 'instock' | 'outofstock' }[] = [];

      for (const wtProduct of wtProducts) {
        const wooId = this.skuToWooIdMap.get(wtProduct.sku);
        if (!wooId) continue;

        const stockQuantity = typeof wtProduct.stock_quantity === 'string'
          ? parseInt(wtProduct.stock_quantity, 10)
          : wtProduct.stock_quantity;

        stockUpdates.push({
          id: wooId,
          stock_quantity: stockQuantity || 0,
          stock_status: (stockQuantity || 0) > 0 ? 'instock' : 'outofstock',
        });

        // Process in batches
        if (stockUpdates.length >= batchSize) {
          try {
            await wooClient.batchUpdateStock(stockUpdates);
            updated += stockUpdates.length;
          } catch (error) {
            console.error('Batch stock update failed:', error);
            failed += stockUpdates.length;
          }
          stockUpdates.length = 0;
        }
      }

      // Process remaining updates
      if (stockUpdates.length > 0) {
        try {
          await wooClient.batchUpdateStock(stockUpdates);
          updated += stockUpdates.length;
        } catch (error) {
          console.error('Final batch stock update failed:', error);
          failed += stockUpdates.length;
        }
      }

      this.logSync('STOCK_UPDATE', {
        status: 'completed',
        recordsTotal: wtProducts.length,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Stock update completed: ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('STOCK_UPDATE', {
        status: 'failed',
        errorMessage,
      });
      throw error;
    }

    return { updated, failed };
  }

  /**
   * Full sync - sync everything to WooCommerce
   */
  async fullSync(options: { uploadImages?: boolean } = {}): Promise<{
    categories: { added: number; updated: number; failed: number };
    manufacturers: { added: number; updated: number; failed: number };
    products: { added: number; updated: number; failed: number };
  }> {
    this.logSync('FULL_SYNC', { status: 'started' });

    try {
      console.log('Starting full sync to WooCommerce...');

      // Sync in order: categories -> manufacturers -> products
      const categories = await this.syncCategories();
      const manufacturers = await this.syncManufacturers();
      const products = await this.syncProducts({ uploadImages: options.uploadImages });

      const totalRecords =
        categories.added + categories.updated +
        manufacturers.added + manufacturers.updated +
        products.added + products.updated;

      this.logSync('FULL_SYNC', {
        status: 'completed',
        recordsTotal: totalRecords,
        recordsAdded: categories.added + manufacturers.added + products.added,
        recordsUpdated: categories.updated + manufacturers.updated + products.updated,
        recordsFailed: categories.failed + manufacturers.failed + products.failed,
      });

      console.log('Full sync completed successfully!');

      return { categories, manufacturers, products };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSync('FULL_SYNC', {
        status: 'failed',
        errorMessage,
      });
      throw error;
    }
  }

  /**
   * Test WooCommerce connection
   */
  async testConnection(): Promise<boolean> {
    return wooClient.testConnection();
  }
}

// Export singleton instance
export const syncService = new WilliamsTradingSyncService();
