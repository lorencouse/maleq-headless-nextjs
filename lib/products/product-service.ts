import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG, GET_ALL_PRODUCT_SLUGS } from '@/lib/queries/products';
import type { UnifiedProduct } from './combined-service';

export interface ProductSpecification {
  label: string;
  value: string;
}

export interface ProductVariation {
  id: string;
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
  gallery: Array<{
    id: string;
    url: string;
    altText: string;
    isPrimary: boolean;
  }>;
}

/**
 * Extract product specifications from WooCommerce product
 */
function extractSpecifications(product: any): ProductSpecification[] {
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

  // Stock availability
  const stockStatus = product.stockStatus || 'OUT_OF_STOCK';
  specs.push({
    label: 'Availability',
    value: stockStatus === 'IN_STOCK' ? 'In Stock' :
           stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'On Backorder'
  });

  if (product.stockQuantity) {
    specs.push({ label: 'Stock Quantity', value: product.stockQuantity.toString() });
  }

  // Product attributes
  if (product.attributes?.nodes) {
    for (const attr of product.attributes.nodes) {
      if (attr.visible && attr.options?.length > 0) {
        specs.push({
          label: attr.name,
          value: attr.options.join(', ')
        });
      }
    }
  }

  return specs;
}

/**
 * Get product by slug from WooCommerce
 */
export async function getProductBySlug(slug: string): Promise<EnhancedProduct | null> {
  try {
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
      variables: { slug },
    });

    const product = data?.product;
    if (!product) return null;

    const specifications = extractSpecifications(product);

    const enhancedProduct: EnhancedProduct = {
      id: product.id,
      databaseId: product.databaseId,
      name: product.name,
      slug: product.slug,
      description: product.description || null,
      shortDescription: product.shortDescription || null,
      sku: product.sku || null,
      price: product.price || null,
      regularPrice: product.regularPrice || null,
      salePrice: product.salePrice || null,
      onSale: product.onSale || false,
      stockStatus: product.stockStatus || 'OUT_OF_STOCK',
      stockQuantity: product.stockQuantity || null,
      image: product.image ? {
        url: product.image.sourceUrl,
        altText: product.image.altText || product.name,
      } : null,
      galleryImages: product.galleryImages?.nodes?.map((img: any) => ({
        url: img.sourceUrl,
        altText: img.altText || product.name,
      })),
      categories: product.productCategories?.nodes?.map((cat: any) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
      })) || [],
      tags: product.productTags?.nodes?.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
      })),
      type: product.type || 'SIMPLE',
      averageRating: product.averageRating,
      reviewCount: product.reviewCount,
      attributes: product.attributes?.nodes?.map((attr: any) => ({
        name: attr.name,
        options: attr.options || [],
        visible: attr.visible ?? true,
      })),
      variations: product.variations?.nodes?.map((v: any) => ({
        id: v.id,
        name: v.name,
        price: v.price || null,
        regularPrice: v.regularPrice || null,
        salePrice: v.salePrice || null,
        stockStatus: v.stockStatus || 'OUT_OF_STOCK',
        stockQuantity: v.stockQuantity || null,
        attributes: v.attributes?.nodes?.map((a: any) => ({
          name: a.name,
          value: a.value,
        })) || [],
      })),
      specifications,
      gallery: [
        // Primary image first
        ...(product.image ? [{
          id: product.image.id || '0',
          url: product.image.sourceUrl,
          altText: product.image.altText || product.name,
          isPrimary: true,
        }] : []),
        // Gallery images
        ...(product.galleryImages?.nodes?.map((img: any, index: number) => ({
          id: img.id || String(index + 1),
          url: img.sourceUrl,
          altText: img.altText || product.name,
          isPrimary: false,
        })) || []),
      ],
    };

    return enhancedProduct;
  } catch (error) {
    console.error('Error fetching product by slug:', error);
    return null;
  }
}

/**
 * Get all product slugs for static generation
 */
export async function getAllProductSlugs(): Promise<string[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_PRODUCT_SLUGS,
    });

    return data?.products?.nodes?.map((p: { slug: string }) => p.slug) || [];
  } catch (error) {
    console.error('Error fetching product slugs:', error);
    return [];
  }
}
