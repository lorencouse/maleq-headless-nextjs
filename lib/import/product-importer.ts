import { wooClient } from '../woocommerce/client';
import type { WooProduct, WooProductImage, WooProductAttribute, WooProductVariation } from '../woocommerce/types';
import { ImageProcessor } from './image-processor';
import { XMLParser, type XMLProduct, type VariationGroup } from './xml-parser';
import type { CategoryImporter } from './category-importer';
import type { ManufacturerImporter } from './manufacturer-importer';

interface ImportConfig {
  priceMultiplier: number; // 3x
  saleDiscountPercent: number; // 10%
  baseImageUrl: string;
  batchSize: number;
  skipImages: boolean; // Skip image processing during import
}

interface ImportResults {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ sku: string; message: string }>;
  variableProducts: number;
  simpleProducts: number;
}

/**
 * Main product importer
 * Handles importing products from XML into WooCommerce
 */
export class ProductImporter {
  private config: ImportConfig;
  private imageProcessor: ImageProcessor;
  private categoryMapping: Record<string, number> | null = null;
  private manufacturerMapping: Record<string, number> | null = null;

  constructor(
    config: Partial<ImportConfig> = {},
    private categoryImporter: CategoryImporter,
    private manufacturerImporter: ManufacturerImporter
  ) {
    this.config = {
      priceMultiplier: 3,
      saleDiscountPercent: 10,
      baseImageUrl: 'https://images.williams-trading.com',
      batchSize: 50,
      skipImages: false,
      ...config,
    };

    this.imageProcessor = new ImageProcessor();
  }

  /**
   * Initialize importer - load mappings
   */
  async init(): Promise<void> {
    await this.imageProcessor.init();

    // Load category mapping
    const catMapping = this.categoryImporter.loadMapping();
    this.categoryMapping = catMapping?.codeToId || null;

    // Load manufacturer mapping
    const mfgMapping = this.manufacturerImporter.loadMapping();
    this.manufacturerMapping = mfgMapping?.codeToId || null;

    if (!this.categoryMapping) {
      console.warn('Warning: No category mapping found. Run category import first.');
    }

    if (!this.manufacturerMapping) {
      console.warn('Warning: No manufacturer mapping found. Run manufacturer import first.');
    }
  }

  /**
   * Calculate prices based on config
   */
  private calculatePrices(basePrice: string): { regular: string; sale: string } {
    const base = parseFloat(basePrice);
    const regular = (base * this.config.priceMultiplier).toFixed(2);
    const sale = (parseFloat(regular) * (1 - this.config.saleDiscountPercent / 100)).toFixed(2);

    return { regular, sale };
  }

  /**
   * Transform XML product to WooCommerce product
   */
  private async transformProduct(
    xmlProduct: XMLProduct,
    uploadedImages: Array<{ mediaId: number; url: string }>
  ): Promise<WooProduct> {
    const prices = this.calculatePrices(xmlProduct.price);

    // Prepare images
    const images: WooProductImage[] = uploadedImages.map((img, index) => ({
      id: img.mediaId,
      src: img.url,
      name: this.imageProcessor.generateFilename(xmlProduct.name, index),
      alt: `${XMLParser.applyTitleCase(xmlProduct.name)} - Image ${index + 1}`,
      position: index,
    }));

    // Get categories
    const categories: { id: number }[] = [];
    if (this.categoryMapping) {
      for (const cat of xmlProduct.categories) {
        const categoryId = this.categoryMapping[cat.code];
        if (categoryId) {
          categories.push({ id: categoryId });
        }
      }
    }

    // Stock status
    const stockQty = parseInt(xmlProduct.stock_quantity, 10);
    const stockStatus = stockQty > 0 ? 'instock' : 'outofstock';

    // Build product
    const product: WooProduct = {
      name: XMLParser.applyTitleCase(xmlProduct.name),
      slug: this.generateSlug(xmlProduct.name),
      type: 'simple',
      status: xmlProduct.active === '1' ? 'publish' : 'draft',
      description: XMLParser.cleanDescription(xmlProduct.description),
      short_description: XMLParser.generateShortDescription(xmlProduct.description),
      sku: xmlProduct.barcode, // Use UPC as SKU
      regular_price: prices.regular,
      sale_price: prices.sale, // Always set sale price (10% off regular)
      on_sale: true, // Always on sale since we always have a sale price
      manage_stock: true,
      stock_quantity: stockQty,
      stock_status: stockStatus,
      weight: xmlProduct.weight || '',
      dimensions: {
        length: xmlProduct.length || '',
        width: xmlProduct.diameter || '', // diameter maps to width
        height: xmlProduct.height || '',
      },
      categories,
      images,
      meta_data: [
        { key: '_wt_sku', value: xmlProduct.sku },
        { key: '_wt_barcode', value: xmlProduct.barcode },
        { key: '_wt_manufacturer_code', value: xmlProduct.manufacturer.code },
        { key: '_wt_product_type_code', value: xmlProduct.type.code },
        { key: '_wt_color', value: xmlProduct.color },
        { key: '_wt_material', value: xmlProduct.material },
        { key: '_wt_discountable', value: xmlProduct.discountable },
        { key: '_wt_active', value: xmlProduct.active },
        { key: '_wt_on_sale', value: xmlProduct.on_sale },
        { key: '_wt_release_date', value: xmlProduct.release_date },
        { key: '_wt_last_synced', value: new Date().toISOString() },
      ],
    };

    // Add attributes if present
    const attributes: WooProductAttribute[] = [];

    if (xmlProduct.color) {
      attributes.push({
        name: 'Color',
        options: [xmlProduct.color],
        visible: true,
        variation: false,
      });
    }

    if (xmlProduct.material) {
      attributes.push({
        name: 'Material',
        options: [xmlProduct.material],
        visible: true,
        variation: false,
      });
    }

    if (attributes.length > 0) {
      product.attributes = attributes;
    }

    return product;
  }

  /**
   * Generate slug from product name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 200);
  }

  /**
   * Import a single simple product
   */
  private async importSimpleProduct(xmlProduct: XMLProduct): Promise<void> {
    console.log(`\n→ Importing: ${xmlProduct.name}`);
    console.log(`  SKU: ${xmlProduct.barcode}`);

    // Check if product exists
    const existing = await wooClient.getProductBySku(xmlProduct.barcode);
    if (existing) {
      console.log(`  ⊕ Product already exists (ID: ${existing.id}), skipping`);
      throw new Error('PRODUCT_EXISTS');
    }

    // Process images (if not skipped)
    let uploadedImages: Array<{ mediaId: number; url: string }> = [];

    if (this.config.skipImages) {
      console.log(`  ⊕ Skipping image processing (skipImages=true)`);
    } else {
      console.log(`  Processing ${xmlProduct.images.length} images...`);
      uploadedImages = await this.imageProcessor.processAndUploadImages(
        xmlProduct.images,
        xmlProduct.name,
        this.config.baseImageUrl
      );

      if (uploadedImages.length === 0) {
        console.warn('  ⚠ No images uploaded, continuing without images');
      } else {
        console.log(`  ✓ Uploaded ${uploadedImages.length} images`);
      }
    }

    // Transform to WooCommerce format
    const wooProduct = await this.transformProduct(xmlProduct, uploadedImages);

    // Create product
    const created = await wooClient.createProduct(wooProduct);
    console.log(`  ✓ Created product (ID: ${created.id})`);
  }

  /**
   * Import a variable product with variations
   */
  private async importVariableProduct(group: VariationGroup): Promise<void> {
    console.log(`\n→ Importing Variable Product: ${group.baseName}`);
    console.log(`  ${group.products.length} variations`);

    // Use first product's data for parent
    const firstProduct = group.products[0];

    // Check if parent product exists (by slug)
    const parentSlug = this.generateSlug(group.baseName);

    // Process all variation images concurrently (if not skipped)
    let variationImages: Array<{ product: XMLProduct; images: Array<{ mediaId: number; url: string; filename: string }> }> = [];

    if (this.config.skipImages) {
      console.log(`  ⊕ Skipping image processing (skipImages=true)`);
      variationImages = group.products.map((product) => ({
        product,
        images: [],
      }));
    } else {
      console.log(`  Processing images for all variations...`);
      variationImages = await Promise.all(
        group.products.map(async (product, index) => {
          console.log(`    Variation ${index + 1}/${group.products.length}: ${product.name}`);
          const images = await this.imageProcessor.processAndUploadImages(
            product.images,
            product.name,
            this.config.baseImageUrl
          );
          return { product, images };
        })
      );
    }

    // Create parent product
    const prices = this.calculatePrices(firstProduct.price);
    const categories: { id: number }[] = [];
    if (this.categoryMapping) {
      for (const cat of firstProduct.categories) {
        const categoryId = this.categoryMapping[cat.code];
        if (categoryId) {
          categories.push({ id: categoryId });
        }
      }
    }

    // Use first variation's images for parent
    const parentImages: WooProductImage[] = variationImages[0].images.map((img, index) => ({
      id: img.mediaId,
      src: img.url,
      name: img.filename,
      alt: `${XMLParser.applyTitleCase(group.baseName)} - Image ${index + 1}`,
      position: index,
    }));

    // Create variation attribute
    const variationAttrName = group.variationAttribute === 'flavor' ? 'Flavor' :
                              group.variationAttribute === 'color' ? 'Color' :
                              group.variationAttribute === 'size' ? 'Size' : 'Variant';

    const variationOptions = group.products.map(p => {
      let option = '';

      if (group.variationAttribute === 'color') {
        option = p.color;
      } else if (group.variationAttribute === 'size') {
        const match = p.name.match(/\d+(\.\d+)?\s*(OZ|ML|G|LB)/i);
        option = match ? match[0] : p.name.split(' ').pop() || '';
      } else {
        // Extract flavor from name
        option = p.name.replace(group.baseName, '').trim();
      }

      // Apply title case to the option
      return XMLParser.applyTitleCase(option);
    });

    // Generate a unique parent SKU from the group
    const parentSku = `VAR-${firstProduct.manufacturer.code}-${group.baseName.substring(0, 30).replace(/[^a-z0-9]/gi, '-').toUpperCase()}`;

    const parentProduct: WooProduct = {
      name: XMLParser.applyTitleCase(group.baseName),
      slug: parentSlug,
      sku: parentSku,
      type: 'variable',
      status: firstProduct.active === '1' ? 'publish' : 'draft',
      description: XMLParser.cleanDescription(firstProduct.description),
      short_description: XMLParser.generateShortDescription(firstProduct.description),
      categories,
      images: parentImages,
      attributes: [
        {
          name: variationAttrName,
          options: variationOptions,
          visible: true,
          variation: true,
        },
      ],
      default_attributes: [
        {
          name: variationAttrName,
          option: variationOptions[0], // Set first variation as default
        },
      ],
      meta_data: [
        { key: '_wt_manufacturer_code', value: firstProduct.manufacturer.code },
        { key: '_wt_product_type_code', value: firstProduct.type.code },
        { key: '_wt_last_synced', value: new Date().toISOString() },
      ],
    };

    const createdParent = await wooClient.createProduct(parentProduct);
    console.log(`  ✓ Created parent product (ID: ${createdParent.id})`);

    // Create variations
    for (let i = 0; i < group.products.length; i++) {
      const varProduct = group.products[i];
      const varImages = variationImages[i].images;
      const prices = this.calculatePrices(varProduct.price);
      const stockQty = parseInt(varProduct.stock_quantity, 10);

      const variationData: Partial<WooProductVariation> = {
        sku: varProduct.barcode,
        regular_price: prices.regular,
        sale_price: prices.sale, // Always set sale price (10% off regular)
        manage_stock: true,
        stock_quantity: stockQty,
        stock_status: stockQty > 0 ? 'instock' : 'outofstock',
        attributes: [
          {
            name: variationAttrName,
            option: variationOptions[i],
          } as any,
        ],
        image: varImages.length > 0 ? {
          id: varImages[0].mediaId,
          src: varImages[0].url,
        } : undefined,
        meta_data: [
          { key: '_wt_sku', value: varProduct.sku },
          { key: '_wt_barcode', value: varProduct.barcode },
        ],
      };

      const createdVariation = await wooClient.createVariation(createdParent.id!, variationData);
      console.log(`    ✓ Created variation: ${variationOptions[i]} (ID: ${createdVariation.id})`);
    }
  }

  /**
   * Import products from XML
   */
  async importProducts(
    products: XMLProduct[],
    options: { detectVariations?: boolean; limit?: number } = {}
  ): Promise<ImportResults> {
    console.log('\n=== IMPORTING PRODUCTS ===\n');

    const results: ImportResults = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      variableProducts: 0,
      simpleProducts: 0,
    };

    // Limit products if specified
    const productsToImport = options.limit ? products.slice(0, options.limit) : products;
    console.log(`Importing ${productsToImport.length} products\n`);

    // Detect variations if enabled
    let variationGroups: VariationGroup[] = [];
    let simpleProducts: XMLProduct[] = [];

    if (options.detectVariations) {
      console.log('Detecting variations...');
      const parser = new XMLParser('');
      variationGroups = parser.detectVariations(productsToImport);
      console.log(`Found ${variationGroups.length} variable products\n`);

      // Get products that are not part of variation groups
      const variationSkus = new Set(
        variationGroups.flatMap(g => g.products.map(p => p.sku))
      );
      simpleProducts = productsToImport.filter(p => !variationSkus.has(p.sku));
    } else {
      simpleProducts = productsToImport;
    }

    console.log(`${simpleProducts.length} simple products to import\n`);

    // Import variable products
    for (const group of variationGroups) {
      try {
        await this.importVariableProduct(group);
        results.created += group.products.length;
        results.variableProducts++;
        results.processed += group.products.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`  ✗ Error: ${message}`);
        results.errors.push({
          sku: group.products[0].barcode,
          message: `Variable product error: ${message}`,
        });
      }
    }

    // Import simple products
    for (const product of simpleProducts) {
      try {
        await this.importSimpleProduct(product);
        results.created++;
        results.simpleProducts++;
        results.processed++;
      } catch (error) {
        if (error instanceof Error && error.message === 'PRODUCT_EXISTS') {
          results.skipped++;
          results.processed++;
        } else {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`  ✗ Error: ${message}`);
          results.errors.push({
            sku: product.barcode,
            message,
          });
        }
      }
    }

    return results;
  }
}
