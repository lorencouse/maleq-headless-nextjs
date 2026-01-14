import { prisma } from '@/lib/prisma';
import { williamsTradingClient } from './client';
import type { WTProduct, WTManufacturer, WTProductType, WTProductImage } from './types';
import { SyncType, SyncStatus, StockStatus } from '@prisma/client';

export class WilliamsTradingSyncService {
  /**
   * Create or update sync log
   */
  private async createSyncLog(syncType: SyncType) {
    return prisma.syncLog.create({
      data: {
        syncType,
        status: SyncStatus.IN_PROGRESS,
      },
    });
  }

  /**
   * Update sync log
   */
  private async updateSyncLog(
    id: string,
    data: {
      status: SyncStatus;
      recordsTotal?: number;
      recordsAdded?: number;
      recordsUpdated?: number;
      recordsFailed?: number;
      errorMessage?: string;
    }
  ) {
    return prisma.syncLog.update({
      where: { id },
      data: {
        ...data,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Sync manufacturers from Williams Trading API
   */
  async syncManufacturers(): Promise<{ added: number; updated: number; failed: number }> {
    const syncLog = await this.createSyncLog(SyncType.MANUFACTURERS);
    let added = 0;
    let updated = 0;
    let failed = 0;

    try {
      console.log('Fetching manufacturers from Williams Trading...');
      const manufacturers = await williamsTradingClient.getManufacturers({ active: '1' });

      console.log(`Found ${manufacturers.length} manufacturers`);

      for (const wtManufacturer of manufacturers) {
        try {
          const existingManufacturer = await prisma.manufacturer.findUnique({
            where: { code: wtManufacturer.code },
          });

          if (existingManufacturer) {
            await prisma.manufacturer.update({
              where: { code: wtManufacturer.code },
              data: {
                name: wtManufacturer.name,
                active: wtManufacturer.active === '1',
              },
            });
            updated++;
          } else {
            await prisma.manufacturer.create({
              data: {
                code: wtManufacturer.code,
                name: wtManufacturer.name,
                active: wtManufacturer.active === '1',
              },
            });
            added++;
          }
        } catch (error) {
          console.error(`Failed to sync manufacturer ${wtManufacturer.code}:`, error);
          failed++;
        }
      }

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal: manufacturers.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Manufacturers sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Sync product types (categories) from Williams Trading API
   */
  async syncProductTypes(): Promise<{ added: number; updated: number; failed: number }> {
    const syncLog = await this.createSyncLog(SyncType.PRODUCT_TYPES);
    let added = 0;
    let updated = 0;
    let failed = 0;

    try {
      console.log('Fetching product types from Williams Trading...');
      const productTypes = await williamsTradingClient.getProductTypes({ active: '1' });

      console.log(`Found ${productTypes.length} product types`);

      // First pass: create/update all types without parent relationships
      for (const wtType of productTypes) {
        try {
          const existingType = await prisma.productType.findUnique({
            where: { code: wtType.code },
          });

          if (existingType) {
            await prisma.productType.update({
              where: { code: wtType.code },
              data: {
                name: wtType.name,
                description: wtType.description,
                active: wtType.active === '1',
              },
            });
            updated++;
          } else {
            await prisma.productType.create({
              data: {
                code: wtType.code,
                name: wtType.name,
                description: wtType.description,
                active: wtType.active === '1',
              },
            });
            added++;
          }
        } catch (error) {
          console.error(`Failed to sync product type ${wtType.code}:`, error);
          failed++;
        }
      }

      // Second pass: establish parent-child relationships
      // Build a map of API ID to code
      const idToCode = new Map<string, string>();
      for (const wtType of productTypes) {
        const apiId = (wtType as any).id;
        if (apiId) {
          idToCode.set(apiId, wtType.code);
        }
      }

      for (const wtType of productTypes) {
        const parentApiId = (wtType as any).parent_id;
        if (parentApiId && parentApiId !== '0') {
          try {
            // Find parent code from API ID
            const parentCode = idToCode.get(parentApiId);
            if (parentCode) {
              const parentType = await prisma.productType.findUnique({
                where: { code: parentCode },
              });

              if (parentType) {
                await prisma.productType.update({
                  where: { code: wtType.code },
                  data: {
                    parentId: parentType.id,
                  },
                });
              }
            }
          } catch (error) {
            console.error(`Failed to set parent for type ${wtType.code}:`, error);
          }
        }
      }

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal: productTypes.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Product types sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Determine stock status from quantity
   */
  private getStockStatus(quantity: number): StockStatus {
    if (quantity === 0) return StockStatus.OUT_OF_STOCK;
    if (quantity < 5) return StockStatus.LOW_STOCK;
    return StockStatus.IN_STOCK;
  }

  /**
   * Sync products from Williams Trading API
   */
  async syncProducts(activeOnly: boolean = true, limit?: number): Promise<{ added: number; updated: number; failed: number }> {
    const syncLog = await this.createSyncLog(SyncType.PRODUCTS);
    let added = 0;
    let updated = 0;
    let failed = 0;

    try {
      console.log('Fetching products from Williams Trading...');
      const params = limit ? { count: limit } : {};
      const products = activeOnly
        ? await williamsTradingClient.getActiveProducts(params)
        : await williamsTradingClient.getProducts(params);

      console.log(`Found ${products.length} products`);

      for (const wtProduct of products) {
        try {
          // Skip products without SKU
          if (!wtProduct.sku) {
            console.warn('Skipping product without SKU:', wtProduct);
            failed++;
            continue;
          }

          const stockQuantity = parseInt(String(wtProduct.stock_quantity), 10) || 0;
          const stockStatus = this.getStockStatus(stockQuantity);

          // Find manufacturer and product type
          let manufacturerId: string | null = null;
          let productTypeId: string | null = null;

          // Handle manufacturer - API returns nested manufacturer object
          const manufacturerCode = (wtProduct as any).manufacturer?.code || wtProduct.manufacturer_code;
          if (manufacturerCode) {
            const manufacturer = await prisma.manufacturer.findUnique({
              where: { code: manufacturerCode },
            });
            manufacturerId = manufacturer?.id || null;
          }

          // Handle product type - API returns nested type object
          const typeCode = (wtProduct as any).type?.code || wtProduct.product_type_code;
          if (typeCode) {
            const productType = await prisma.productType.findUnique({
              where: { code: typeCode },
            });
            productTypeId = productType?.id || null;
          }

          const existingProduct = await prisma.product.findUnique({
            where: { sku: wtProduct.sku },
          });

          const productData = {
            name: wtProduct.name,
            description: wtProduct.description,
            shortDescription: wtProduct.short_description,
            price: wtProduct.price ? parseFloat(wtProduct.price) : null,
            retailPrice: wtProduct.retail_price ? parseFloat(wtProduct.retail_price) : null,
            salePrice: wtProduct.sale_price ? parseFloat(wtProduct.sale_price) : null,
            onSale: wtProduct.on_sale === '1',
            stockQuantity,
            stockStatus,
            lastStockUpdate: new Date(),
            active: wtProduct.active === '1',
            weight: wtProduct.weight ? parseFloat(wtProduct.weight) : null,
            length: wtProduct.length ? parseFloat(wtProduct.length) : null,
            width: wtProduct.width ? parseFloat(wtProduct.width) : null,
            height: wtProduct.height ? parseFloat(wtProduct.height) : null,
            upcCode: wtProduct.upc_code,
            manufacturerSku: wtProduct.manufacturer_sku,
            releaseDate: wtProduct.release_date ? new Date(wtProduct.release_date) : null,
            manufacturerId,
            productTypeId,
            rawData: JSON.stringify(wtProduct),
          };

          if (existingProduct) {
            // Check if stock changed
            if (existingProduct.stockQuantity !== stockQuantity || existingProduct.stockStatus !== stockStatus) {
              await prisma.stockHistory.create({
                data: {
                  productId: existingProduct.id,
                  previousQty: existingProduct.stockQuantity,
                  newQty: stockQuantity,
                  previousStatus: existingProduct.stockStatus,
                  newStatus: stockStatus,
                },
              });
            }

            await prisma.product.update({
              where: { sku: wtProduct.sku },
              data: productData,
            });
            updated++;
          } else {
            const newProduct = await prisma.product.create({
              data: {
                sku: wtProduct.sku,
                ...productData,
              },
            });

            // Create initial stock history
            await prisma.stockHistory.create({
              data: {
                productId: newProduct.id,
                previousQty: 0,
                newQty: stockQuantity,
                previousStatus: StockStatus.OUT_OF_STOCK,
                newStatus: stockStatus,
              },
            });

            added++;
          }
        } catch (error) {
          console.error(`Failed to sync product ${wtProduct.sku}:`, error);
          failed++;
        }
      }

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal: products.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Products sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Sync product images
   */
  async syncProductImages(): Promise<{ added: number; updated: number; failed: number }> {
    const syncLog = await this.createSyncLog(SyncType.IMAGES);
    let added = 0;
    let updated = 0;
    let failed = 0;

    try {
      console.log('Fetching product images from Williams Trading...');

      // Get all products that need images
      const products = await prisma.product.findMany({
        where: { source: 'WILLIAMS_TRADING' },
        select: { id: true, sku: true },
      });

      console.log(`Fetching images for ${products.length} products`);

      for (const product of products) {
        try {
          const wtImages = await williamsTradingClient.getProductImages(product.sku);

          for (const wtImage of wtImages) {
            const imageUrl = williamsTradingClient.getImageUrl(wtImage.image_url);
            const sortOrder = parseInt(String(wtImage.sort_order), 10) || 0;

            const existingImage = await prisma.productImage.findFirst({
              where: {
                productId: product.id,
                fileName: wtImage.file_name,
              },
            });

            if (existingImage) {
              await prisma.productImage.update({
                where: { id: existingImage.id },
                data: {
                  imageUrl,
                  sortOrder,
                  isPrimary: wtImage.is_primary === '1',
                },
              });
              updated++;
            } else {
              await prisma.productImage.create({
                data: {
                  productId: product.id,
                  imageUrl,
                  fileName: wtImage.file_name,
                  sortOrder,
                  isPrimary: wtImage.is_primary === '1',
                },
              });
              added++;
            }
          }
        } catch (error) {
          console.error(`Failed to sync images for product ${product.sku}:`, error);
          failed++;
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal: products.length,
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Product images sync completed: ${added} added, ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }

    return { added, updated, failed };
  }

  /**
   * Update stock quantities only (for hourly updates)
   */
  async updateStock(): Promise<{ updated: number; failed: number }> {
    const syncLog = await this.createSyncLog(SyncType.STOCK_UPDATE);
    let updated = 0;
    let failed = 0;

    try {
      console.log('Updating stock from Williams Trading...');
      const products = await williamsTradingClient.getActiveProducts();

      console.log(`Updating stock for ${products.length} products`);

      for (const wtProduct of products) {
        try {
          const existingProduct = await prisma.product.findUnique({
            where: { sku: wtProduct.sku },
          });

          if (existingProduct) {
            const stockQuantity = parseInt(String(wtProduct.stock_quantity), 10) || 0;
            const stockStatus = this.getStockStatus(stockQuantity);

            // Only update if stock changed
            if (
              existingProduct.stockQuantity !== stockQuantity ||
              existingProduct.stockStatus !== stockStatus
            ) {
              await prisma.stockHistory.create({
                data: {
                  productId: existingProduct.id,
                  previousQty: existingProduct.stockQuantity,
                  newQty: stockQuantity,
                  previousStatus: existingProduct.stockStatus,
                  newStatus: stockStatus,
                },
              });

              await prisma.product.update({
                where: { sku: wtProduct.sku },
                data: {
                  stockQuantity,
                  stockStatus,
                  lastStockUpdate: new Date(),
                },
              });

              updated++;
            }
          }
        } catch (error) {
          console.error(`Failed to update stock for product ${wtProduct.sku}:`, error);
          failed++;
        }
      }

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal: products.length,
        recordsUpdated: updated,
        recordsFailed: failed,
      });

      console.log(`Stock update completed: ${updated} updated, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }

    return { updated, failed };
  }

  /**
   * Full sync - sync everything
   */
  async fullSync(): Promise<{
    manufacturers: { added: number; updated: number; failed: number };
    productTypes: { added: number; updated: number; failed: number };
    products: { added: number; updated: number; failed: number };
    images: { added: number; updated: number; failed: number };
  }> {
    const syncLog = await this.createSyncLog(SyncType.FULL_SYNC);

    try {
      console.log('Starting full sync...');

      const manufacturers = await this.syncManufacturers();
      const productTypes = await this.syncProductTypes();
      const products = await this.syncProducts();
      const images = await this.syncProductImages();

      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.COMPLETED,
        recordsTotal:
          manufacturers.added +
          manufacturers.updated +
          productTypes.added +
          productTypes.updated +
          products.added +
          products.updated +
          images.added +
          images.updated,
      });

      console.log('Full sync completed successfully!');

      return { manufacturers, productTypes, products, images };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSyncLog(syncLog.id, {
        status: SyncStatus.FAILED,
        errorMessage,
      });
      throw error;
    }
  }
}

// Export singleton instance
export const syncService = new WilliamsTradingSyncService();
