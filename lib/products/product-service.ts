import { prisma } from '@/lib/prisma';
import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG } from '@/lib/queries/products';
import { UnifiedProduct } from './combined-service';
import { processProductImages } from '@/lib/utils/image-processor';

export interface ProductSpecification {
  label: string;
  value: string;
}

export interface ProductVariation {
  id: string;
  sku: string;
  name: string;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  attributes: Array<{
    name: string;
    value: string;
  }>;
  image?: {
    url: string;
    altText: string;
  } | null;
}

export interface EnhancedProduct extends UnifiedProduct {
  specifications: ProductSpecification[];
  rawApiData: any;
  gallery: Array<{
    id: string;
    url: string;
    altText: string;
    title: string;
    isPrimary: boolean;
  }>;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    weight?: number;
  };
  releaseDate?: Date | null;
  upcCode?: string | null;
  // Variation support
  isVariableProduct?: boolean;
  variations?: Array<{
    id: string;
    sku: string;
    name: string;
    price: string | null;
    stockStatus: string;
    stockQuantity: number;
    attributes: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Extract product specifications from Williams Trading raw data
 */
function extractSpecifications(product: any): ProductSpecification[] {
  const specs: ProductSpecification[] = [];

  // Parse raw data if it exists
  let rawData = product.rawData;
  if (typeof rawData === 'string') {
    try {
      rawData = JSON.parse(rawData);
    } catch (e) {
      rawData = null;
    }
  }

  // Basic specifications
  if (product.sku) {
    specs.push({ label: 'SKU', value: product.sku });
  }

  if (product.upcCode) {
    specs.push({ label: 'UPC Code', value: product.upcCode });
  }

  if (product.manufacturerSku) {
    specs.push({ label: 'Manufacturer SKU', value: product.manufacturerSku });
  }

  if (product.manufacturer) {
    specs.push({ label: 'Brand', value: product.manufacturer.name });
  }

  if (product.productType) {
    specs.push({ label: 'Category', value: product.productType.name });
  }

  // Dimensions
  if (product.length || product.width || product.height) {
    const dimensions = [];
    if (product.length) dimensions.push(`L: ${product.length}"`);
    if (product.width) dimensions.push(`W: ${product.width}"`);
    if (product.height) dimensions.push(`H: ${product.height}"`);
    specs.push({ label: 'Dimensions', value: dimensions.join(' × ') });
  }

  if (product.weight) {
    specs.push({ label: 'Weight', value: `${product.weight} lbs` });
  }

  // Release date
  if (product.releaseDate) {
    const date = new Date(product.releaseDate);
    specs.push({
      label: 'Release Date',
      value: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    });
  }

  // Stock information
  specs.push({
    label: 'Availability',
    value: product.stockStatus === 'IN_STOCK' ? 'In Stock' :
           product.stockStatus === 'LOW_STOCK' ? `Low Stock (${product.stockQuantity} left)` :
           product.stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'On Backorder'
  });

  // Add any additional fields from raw data
  if (rawData) {
    // Color
    if (rawData.color) {
      specs.push({ label: 'Color', value: rawData.color });
    }

    // Material
    if (rawData.material) {
      specs.push({ label: 'Material', value: rawData.material });
    }

    // Power source
    if (rawData.power_source) {
      specs.push({ label: 'Power Source', value: rawData.power_source });
    }

    // Features (array or string)
    if (rawData.features) {
      const features = Array.isArray(rawData.features)
        ? rawData.features.join(', ')
        : rawData.features;
      specs.push({ label: 'Features', value: features });
    }

    // Any other custom fields you want to display
    // Add more fields here as needed
  }

  return specs;
}

/**
 * Get product by slug from Williams Trading database
 */
async function getWilliamsTradingProduct(slug: string): Promise<EnhancedProduct | null> {
  try {
    // Try to find by SKU or slug-like pattern
    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: slug.toUpperCase().replace(/-/g, '_') },
          { sku: slug.toUpperCase() },
          { sku: { contains: slug.toUpperCase() } },
          { sku: { contains: slug.toLowerCase() } },
        ],
        active: true,
      },
      include: {
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        productType: true,
        manufacturer: true,
        variations: {
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
            variationAttributes: true,
          },
        },
        variationAttributes: true,
      },
    });

    if (!product) return null;

    // Check if images need processing
    const unprocessedImages = product.images.filter(img => !img.isProcessed);
    if (unprocessedImages.length > 0) {
      try {
        // Process images in the background (don't await to avoid blocking page load)
        const imagesToProcess = unprocessedImages.map(img => ({
          url: img.imageUrl,
          id: img.id,
        }));

        processProductImages(imagesToProcess, product.name).then(async (processedImages) => {
          // Update database with processed image data
          for (const [imageId, imageData] of processedImages.entries()) {
            await prisma.productImage.update({
              where: { id: imageId },
              data: {
                localPath: imageData.localPath,
                localFileName: imageData.localFileName,
                imageAlt: imageData.imageAlt,
                imageTitle: imageData.imageTitle,
                isProcessed: true,
                processedAt: new Date(),
              },
            });
          }
        }).catch(error => {
          console.error('Error processing images:', error);
        });
      } catch (error) {
        console.error('Error initiating image processing:', error);
      }
    }

    const primaryImage = product.images.find(img => img.isPrimary) || product.images[0];

    const enhancedProduct: EnhancedProduct = {
      id: product.id,
      name: product.name,
      slug: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: product.description,
      shortDescription: product.shortDescription,
      sku: product.sku,
      price: product.price?.toString() || null,
      regularPrice: product.retailPrice?.toString() || null,
      salePrice: product.salePrice?.toString() || null,
      onSale: product.onSale,
      stockStatus: product.stockStatus,
      stockQuantity: product.stockQuantity,
      image: primaryImage ? {
        url: primaryImage.imageUrl,
        altText: product.name,
      } : null,
      category: product.productType ? {
        name: product.productType.name,
        slug: product.productType.code,
      } : null,
      manufacturer: product.manufacturer ? {
        name: product.manufacturer.name,
        code: product.manufacturer.code,
      } : null,
      source: 'WILLIAMS_TRADING',
      specifications: extractSpecifications(product),
      rawApiData: product.rawData ? (typeof product.rawData === 'string' ? JSON.parse(product.rawData) : product.rawData) : null,
      gallery: product.images.map(img => ({
        id: img.id,
        url: img.localPath || img.imageUrl, // Use local path if available, fallback to original URL
        altText: img.imageAlt || product.name,
        title: img.imageTitle || product.name,
        isPrimary: img.isPrimary,
      })),
      dimensions: {
        length: product.length ? parseFloat(product.length.toString()) : undefined,
        width: product.width ? parseFloat(product.width.toString()) : undefined,
        height: product.height ? parseFloat(product.height.toString()) : undefined,
        weight: product.weight ? parseFloat(product.weight.toString()) : undefined,
      },
      releaseDate: product.releaseDate,
      upcCode: product.upcCode,
      // Include variation data if this is a variable product
      isVariableProduct: product.isVariableProduct,
      variations: product.isVariableProduct && product.variations ? product.variations.map(variation => ({
        id: variation.id,
        sku: variation.sku,
        name: variation.name,
        price: variation.price?.toString() || null,
        stockStatus: variation.stockStatus,
        stockQuantity: variation.stockQuantity,
        attributes: variation.variationAttributes.map(attr => ({
          name: attr.name,
          value: attr.value,
        })),
      })) : undefined,
    };

    return enhancedProduct;
  } catch (error) {
    console.error('Error fetching Williams Trading product:', error);
    return null;
  }
}

/**
 * Get product by slug from WordPress
 */
async function getWordPressProduct(slug: string): Promise<EnhancedProduct | null> {
  try {
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
      variables: { slug },
    });

    const product = data?.product;
    if (!product) return null;

    // Extract basic specs from WordPress product
    const specs: ProductSpecification[] = [];

    if (product.sku) {
      specs.push({ label: 'SKU', value: product.sku });
    }

    if (product.productCategories?.nodes?.length > 0) {
      specs.push({
        label: 'Categories',
        value: product.productCategories.nodes.map((cat: any) => cat.name).join(', ')
      });
    }

    if (product.productTags?.nodes?.length > 0) {
      specs.push({
        label: 'Tags',
        value: product.productTags.nodes.map((tag: any) => tag.name).join(', ')
      });
    }

    specs.push({
      label: 'Availability',
      value: product.stockStatus === 'IN_STOCK' ? 'In Stock' :
             product.stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'On Backorder'
    });

    if (product.stockQuantity) {
      specs.push({ label: 'Stock Quantity', value: product.stockQuantity.toString() });
    }

    const enhancedProduct: EnhancedProduct = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      shortDescription: product.shortDescription,
      sku: product.sku || null,
      price: product.price || null,
      regularPrice: product.regularPrice || null,
      salePrice: product.salePrice || null,
      onSale: product.onSale,
      stockStatus: product.stockStatus,
      stockQuantity: product.stockQuantity || null,
      image: product.image ? {
        url: product.image.sourceUrl,
        altText: product.image.altText || product.name,
      } : null,
      category: product.productCategories?.nodes?.[0] ? {
        name: product.productCategories.nodes[0].name,
        slug: product.productCategories.nodes[0].slug,
      } : null,
      manufacturer: null,
      source: 'WORDPRESS',
      specifications: specs,
      rawApiData: product,
      gallery: product.galleryImages?.nodes?.map((img: any, index: number) => ({
        id: img.id,
        url: img.sourceUrl,
        altText: img.altText || product.name,
        title: img.title || product.name,
        isPrimary: index === 0,
      })) || [],
    };

    return enhancedProduct;
  } catch (error) {
    console.error('Error fetching WordPress product:', error);
    return null;
  }
}

/**
 * Get product by slug from either source
 */
export async function getProductBySlug(slug: string): Promise<EnhancedProduct | null> {
  // Try Williams Trading first
  const wtProduct = await getWilliamsTradingProduct(slug);
  if (wtProduct) return wtProduct;

  // Fall back to WordPress
  const wpProduct = await getWordPressProduct(slug);
  if (wpProduct) return wpProduct;

  return null;
}

/**
 * Get all product slugs for static generation
 */
export async function getAllProductSlugs(): Promise<string[]> {
  const slugs: string[] = [];

  try {
    // Get Williams Trading product SKUs (converted to slugs)
    const wtProducts = await prisma.product.findMany({
      where: { active: true },
      select: { sku: true },
    });

    slugs.push(...wtProducts.map(p => p.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  } catch (error) {
    console.error('Error fetching Williams Trading slugs:', error);
  }

  try {
    // Get WordPress product slugs
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
    });

    if (data?.products?.nodes) {
      slugs.push(...data.products.nodes.map((p: any) => p.slug));
    }
  } catch (error) {
    console.error('Error fetching WordPress slugs:', error);
  }

  return slugs;
}
