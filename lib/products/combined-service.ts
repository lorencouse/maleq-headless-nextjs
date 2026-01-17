import { getClient } from '@/lib/apollo/client';
import {
  GET_ALL_PRODUCTS,
  GET_PRODUCT_BY_SLUG,
  GET_PRODUCTS_BY_CATEGORY,
  SEARCH_PRODUCTS,
  GET_ALL_PRODUCT_CATEGORIES,
  GET_ALL_PRODUCT_SLUGS,
} from '@/lib/queries/products';
import type { Product as WooProduct, ProductCategory } from '@/lib/types/woocommerce';

// Unified product interface for frontend consumption
export interface UnifiedProduct {
  id: string;
  databaseId?: number;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  onSale: boolean;
  stockStatus: string;
  stockQuantity: number | null;
  image: {
    url: string;
    altText: string;
  } | null;
  galleryImages?: {
    url: string;
    altText: string;
  }[];
  categories: {
    id: string;
    name: string;
    slug: string;
  }[];
  tags?: {
    id: string;
    name: string;
    slug: string;
  }[];
  type: string;
  averageRating?: number;
  reviewCount?: number;
  attributes?: {
    name: string;
    options: string[];
    visible: boolean;
  }[];
  variations?: {
    id: string;
    name: string;
    price: string | null;
    regularPrice: string | null;
    salePrice: string | null;
    stockStatus: string;
    stockQuantity: number | null;
    attributes: { name: string; value: string }[];
  }[];
}

/**
 * Convert WooCommerce GraphQL product to unified format
 * Note: GraphQL returns nested objects with `nodes` arrays
 */
function convertWooProduct(product: WooProduct): UnifiedProduct {
  // Helper to extract nodes from GraphQL response
  const getNodes = <T>(data: { nodes?: T[] } | T[] | undefined): T[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.nodes || [];
  };

  const galleryNodes = getNodes(product.galleryImages as any);
  const categoryNodes = getNodes(product.productCategories as any);
  const tagNodes = getNodes(product.productTags as any);
  const attributeNodes = getNodes(product.attributes as any);
  const variationNodes = getNodes(product.variations as any);

  return {
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
    image: product.image
      ? {
          url: product.image.sourceUrl,
          altText: product.image.altText || product.name,
        }
      : null,
    galleryImages: galleryNodes.map((img: any) => ({
      url: img.sourceUrl,
      altText: img.altText || product.name,
    })),
    categories: categoryNodes.map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    })),
    tags: tagNodes.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
    })),
    type: product.type || 'SIMPLE',
    averageRating: product.averageRating,
    reviewCount: product.reviewCount,
    attributes: attributeNodes.map((attr: any) => ({
      name: attr.name,
      options: attr.options || [],
      visible: attr.visible ?? true,
    })),
    variations: variationNodes.map((v: any) => {
      const attrNodes = getNodes(v.attributes as any);
      return {
        id: v.id,
        name: v.name,
        price: v.price || null,
        regularPrice: v.regularPrice || null,
        salePrice: v.salePrice || null,
        stockStatus: v.stockStatus || 'OUT_OF_STOCK',
        stockQuantity: v.stockQuantity || null,
        attributes: attrNodes.map((a: any) => ({
          name: a.name,
          value: a.value,
        })),
      };
    }),
  };
}

/**
 * Get all products with pagination
 */
export async function getAllProducts(params: {
  limit?: number;
  after?: string;
  category?: string;
  search?: string;
} = {}): Promise<{ products: UnifiedProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> {
  const { limit = 12, after, category, search } = params;

  try {
    let query = GET_ALL_PRODUCTS;
    let variables: Record<string, unknown> = { first: limit, after };

    if (category) {
      query = GET_PRODUCTS_BY_CATEGORY;
      variables = { ...variables, category };
    } else if (search) {
      query = SEARCH_PRODUCTS;
      variables = { ...variables, search };
    }

    const { data } = await getClient().query({
      query,
      variables,
    });

    const products: WooProduct[] = data?.products?.nodes || [];
    const pageInfo = data?.products?.pageInfo || { hasNextPage: false, endCursor: null };

    return {
      products: products.map(convertWooProduct),
      pageInfo: {
        hasNextPage: pageInfo.hasNextPage,
        endCursor: pageInfo.endCursor,
      },
    };
  } catch (error) {
    console.error('Error fetching products:', error);
    return { products: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }
}

/**
 * Get a single product by slug
 */
export async function getProductBySlug(slug: string): Promise<UnifiedProduct | null> {
  try {
    const { data } = await getClient().query({
      query: GET_PRODUCT_BY_SLUG,
      variables: { slug },
    });

    const product = data?.product;
    if (!product) return null;

    return convertWooProduct(product);
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

/**
 * Get all product categories
 */
export async function getProductCategories(): Promise<ProductCategory[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_PRODUCT_CATEGORIES,
    });

    return data?.productCategories?.nodes || [];
  } catch (error) {
    console.error('Error fetching product categories:', error);
    return [];
  }
}

/**
 * Search products
 */
export async function searchProducts(searchTerm: string, limit = 12): Promise<UnifiedProduct[]> {
  const result = await getAllProducts({ search: searchTerm, limit });
  return result.products;
}

/**
 * Get products by category
 */
export async function getProductsByCategory(category: string, limit = 12): Promise<UnifiedProduct[]> {
  const result = await getAllProducts({ category, limit });
  return result.products;
}
