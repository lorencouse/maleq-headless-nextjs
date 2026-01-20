import { getClient } from '@/lib/apollo/client';
import {
  GET_ALL_PRODUCTS,
  GET_PRODUCTS_BY_CATEGORY,
  SEARCH_PRODUCTS,
  GET_ALL_PRODUCT_CATEGORIES,
  FILTER_PRODUCTS,
  GET_HIERARCHICAL_CATEGORIES,
  GET_ALL_BRANDS,
  GET_GLOBAL_ATTRIBUTES,
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
    sku: string | null;
    price: string | null;
    regularPrice: string | null;
    salePrice: string | null;
    stockStatus: string;
    stockQuantity: number | null;
    attributes: { name: string; value: string }[];
  }[];
}

// Hierarchical category interface for nested category tree
export interface HierarchicalCategory {
  id: string;
  name: string;
  slug: string;
  count: number;
  children: HierarchicalCategory[];
}

// Filter option interface for brands and attributes
export interface FilterOption {
  id: string;
  name: string;
  slug: string;
  count: number | null;
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
        sku: v.sku || null,
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
 * Get filtered products with DB-level filtering
 * Uses the FILTER_PRODUCTS query for price, stock, sale, and taxonomy filters
 */
export async function getFilteredProducts(params: {
  limit?: number;
  after?: string;
  category?: string;
  brand?: string;
  color?: string;
  material?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
}): Promise<{ products: UnifiedProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> {
  const { limit = 24, after, category, brand, color, material, minPrice, maxPrice, inStock, onSale } = params;

  try {
    // Build variables for the filter query
    const variables: Record<string, unknown> = {
      first: limit,
      after: after || null,
    };

    // Only add filters if they have meaningful values
    if (category) {
      variables.category = category;
    }
    if (minPrice !== undefined && minPrice > 0) {
      variables.minPrice = minPrice;
    }
    if (maxPrice !== undefined && maxPrice < 10000) {
      variables.maxPrice = maxPrice;
    }
    if (onSale === true) {
      variables.onSale = true;
    }
    if (inStock === true) {
      variables.stockStatus = ['IN_STOCK'];
    }

    // Build taxonomy filter for brand, color, and material
    const taxonomyFilters: { taxonomy: string; terms: string[] }[] = [];

    if (brand) {
      taxonomyFilters.push({ taxonomy: 'PRODUCT_BRAND', terms: [brand] });
    }
    if (color) {
      taxonomyFilters.push({ taxonomy: 'PA_COLOR', terms: [color] });
    }
    if (material) {
      taxonomyFilters.push({ taxonomy: 'PA_MATERIAL', terms: [material] });
    }

    if (taxonomyFilters.length > 0) {
      variables.taxonomyFilter = {
        relation: 'AND',
        filters: taxonomyFilters,
      };
    }

    const { data } = await getClient().query({
      query: FILTER_PRODUCTS,
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
    console.error('Error fetching filtered products:', error);
    return { products: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }
}


/**
 * Get all product categories
 * Paginates through all categories since WPGraphQL has a bug with hideEmpty filter
 * that incorrectly limits results to 100
 */
export async function getProductCategories(): Promise<ProductCategory[]> {
  try {
    const allCategories: ProductCategory[] = [];
    let hasNextPage = true;
    let afterCursor: string | null = null;

    // Paginate through all categories
    while (hasNextPage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await getClient().query({
        query: GET_ALL_PRODUCT_CATEGORIES,
        variables: {
          first: 100,
          after: afterCursor,
        },
      });

      const nodes: ProductCategory[] = result.data?.productCategories?.nodes || [];
      const pageInfoData = result.data?.productCategories?.pageInfo;

      allCategories.push(...nodes);

      hasNextPage = pageInfoData?.hasNextPage ?? false;
      afterCursor = pageInfoData?.endCursor ?? null;

      // Safety limit to prevent infinite loops
      if (allCategories.length > 1000) break;
    }

    // Filter out empty categories (count = 0 or null) and sort alphabetically
    return allCategories
      .filter((cat) => cat.count && cat.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching product categories:', error);
    return [];
  }
}

/**
 * Get hierarchical product categories (tree structure)
 * Returns top-level categories with nested children
 */
export async function getHierarchicalCategories(): Promise<HierarchicalCategory[]> {
  try {
    const { data } = await getClient().query({
      query: GET_HIERARCHICAL_CATEGORIES,
    });

    const nodes = data?.productCategories?.nodes || [];

    // Recursively convert GraphQL response to HierarchicalCategory
    function convertCategory(cat: any): HierarchicalCategory {
      const children = cat.children?.nodes || [];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        count: cat.count || 0,
        children: children
          .filter((child: any) => child.count && child.count > 0)
          .map(convertCategory)
          .sort((a: HierarchicalCategory, b: HierarchicalCategory) =>
            a.name.localeCompare(b.name)
          ),
      };
    }

    // Filter out empty categories and sort alphabetically
    return nodes
      .filter((cat: any) => cat.count && cat.count > 0)
      .map(convertCategory)
      .sort((a: HierarchicalCategory, b: HierarchicalCategory) =>
        a.name.localeCompare(b.name)
      );
  } catch (error) {
    console.error('Error fetching hierarchical categories:', error);
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

/**
 * Get all product brands for filtering
 */
export async function getBrands(): Promise<FilterOption[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_BRANDS,
    });

    const nodes = data?.productBrands?.nodes || [];

    return nodes
      .filter((brand: FilterOption) => brand.count && brand.count > 0)
      .map((brand: FilterOption) => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        count: brand.count,
      }))
      .sort((a: FilterOption, b: FilterOption) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching brands:', error);
    return [];
  }
}

/**
 * Get global product attributes (color, material) for filtering
 */
export async function getGlobalAttributes(): Promise<{
  colors: FilterOption[];
  materials: FilterOption[];
}> {
  try {
    const { data } = await getClient().query({
      query: GET_GLOBAL_ATTRIBUTES,
    });

    const colorNodes = data?.allPaColor?.nodes || [];
    const materialNodes = data?.allPaMaterial?.nodes || [];

    const colors = colorNodes
      .filter((attr: FilterOption) => attr.count && attr.count > 0)
      .map((attr: FilterOption) => ({
        id: attr.id,
        name: attr.name,
        slug: attr.slug,
        count: attr.count,
      }))
      .sort((a: FilterOption, b: FilterOption) => a.name.localeCompare(b.name));

    const materials = materialNodes
      .filter((attr: FilterOption) => attr.count && attr.count > 0)
      .map((attr: FilterOption) => ({
        id: attr.id,
        name: attr.name,
        slug: attr.slug,
        count: attr.count,
      }))
      .sort((a: FilterOption, b: FilterOption) => a.name.localeCompare(b.name));

    return { colors, materials };
  } catch (error) {
    console.error('Error fetching global attributes:', error);
    return { colors: [], materials: [] };
  }
}
