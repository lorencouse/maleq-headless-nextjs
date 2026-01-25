import { getClient } from '@/lib/apollo/client';
import type { ApolloQueryResult } from '@apollo/client';
import {
  GET_ALL_PRODUCTS,
  GET_PRODUCTS_BY_CATEGORY,
  SEARCH_PRODUCTS,
  GET_ALL_PRODUCT_CATEGORIES,
  FILTER_PRODUCTS,
  GET_HIERARCHICAL_CATEGORIES,
  GET_ALL_BRANDS,
  GET_BRANDS_PAGE,
  GET_BRAND_BY_SLUG,
  GET_ALL_MATERIALS,
  GET_GLOBAL_ATTRIBUTES,
} from '@/lib/queries/products';
import type {
  Product as WooProduct,
  ProductCategory,
  GraphQLProduct,
  GraphQLImage,
  GraphQLCategory,
  GraphQLTag,
  GraphQLAttribute,
  GraphQLVariation,
  GraphQLVariationAttribute,
  GraphQLNodeConnection,
  GraphQLHierarchicalCategory,
  GraphQLPageInfo,
} from '@/lib/types/woocommerce';

/** Response type for paginated category queries */
interface CategoryQueryResponse {
  productCategories: {
    nodes: ProductCategory[];
    pageInfo: GraphQLPageInfo;
  };
}

/** Response type for paginated brand queries */
interface BrandQueryResponse {
  productBrands: {
    nodes: FilterOption[];
    pageInfo: GraphQLPageInfo;
  };
}

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
  weight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
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
function convertWooProduct(product: WooProduct | GraphQLProduct): UnifiedProduct {
  // Cast to GraphQL type for access to nested nodes structure
  const gqlProduct = product as GraphQLProduct;

  // Helper to extract nodes from GraphQL response
  const getNodes = <T>(data: GraphQLNodeConnection<T> | T[] | undefined): T[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.nodes || [];
  };

  const galleryNodes = getNodes<GraphQLImage>(gqlProduct.galleryImages);
  const categoryNodes = getNodes<GraphQLCategory>(gqlProduct.productCategories);
  const tagNodes = getNodes<GraphQLTag>(gqlProduct.productTags);
  const attributeNodes = getNodes<GraphQLAttribute>(gqlProduct.attributes);
  const variationNodes = getNodes<GraphQLVariation>(gqlProduct.variations);

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
    weight: gqlProduct.weight || null,
    length: gqlProduct.length || null,
    width: gqlProduct.width || null,
    height: gqlProduct.height || null,
    image: product.image
      ? {
          url: product.image.sourceUrl,
          altText: product.image.altText || product.name,
        }
      : null,
    galleryImages: galleryNodes.map((img) => ({
      url: img.sourceUrl,
      altText: img.altText || product.name,
    })),
    categories: categoryNodes.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    })),
    tags: tagNodes.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
    })),
    type: product.type || 'SIMPLE',
    averageRating: product.averageRating,
    reviewCount: product.reviewCount,
    attributes: attributeNodes.map((attr) => ({
      name: attr.name,
      options: attr.options || [],
      visible: attr.visible ?? true,
    })),
    variations: variationNodes.map((v) => {
      const attrNodes = getNodes<GraphQLVariationAttribute>(v.attributes);
      return {
        id: v.id,
        name: v.name,
        sku: v.sku || null,
        price: v.price || null,
        regularPrice: v.regularPrice || null,
        salePrice: v.salePrice || null,
        stockStatus: v.stockStatus || 'OUT_OF_STOCK',
        stockQuantity: v.stockQuantity || null,
        attributes: attrNodes.map((a) => ({
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
      fetchPolicy: 'no-cache',
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
      taxonomyFilters.push({ taxonomy: 'PRODUCT_MATERIAL', terms: [material] });
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
      fetchPolicy: 'no-cache',
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
      const result: ApolloQueryResult<CategoryQueryResponse> = await getClient().query<CategoryQueryResponse>({
        query: GET_ALL_PRODUCT_CATEGORIES,
        variables: {
          first: 100,
          after: afterCursor,
        },
        fetchPolicy: 'no-cache',
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
      fetchPolicy: 'no-cache',
    });

    const nodes: GraphQLHierarchicalCategory[] = data?.productCategories?.nodes || [];

    // Recursively convert GraphQL response to HierarchicalCategory
    function convertCategory(cat: GraphQLHierarchicalCategory): HierarchicalCategory {
      const children = cat.children?.nodes || [];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        count: cat.count || 0,
        children: children
          .filter((child) => child.count && child.count > 0)
          .map(convertCategory)
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    // Filter out empty categories and sort alphabetically
    return nodes
      .filter((cat) => cat.count && cat.count > 0)
      .map(convertCategory)
      .sort((a, b) => a.name.localeCompare(b.name));
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
 * First tries simple query, falls back to paginated query if needed
 */
export async function getBrands(): Promise<FilterOption[]> {
  try {
    // First, try to fetch all brands with a simple query
    const { data } = await getClient().query<BrandQueryResponse>({
      query: GET_ALL_BRANDS,
      fetchPolicy: 'network-only',
    });

    let allBrands: FilterOption[] = data?.productBrands?.nodes || [];
    if (process.env.NODE_ENV === 'development') {
      console.log(`getBrands: Simple query returned ${allBrands.length} brands`);
    }

    // If we got exactly 100 brands (WPGraphQL default limit), pagination might be needed
    if (allBrands.length === 100) {
      if (process.env.NODE_ENV === 'development') {
        console.log('getBrands: Hit limit, using pagination to fetch all brands...');
      }
      allBrands = await fetchBrandsWithPagination();
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`getBrands: Total ${allBrands.length} brands fetched`);
    }

    return allBrands
      .filter((brand) => brand.count && brand.count > 0)
      .map((brand) => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        count: brand.count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching brands:', error);
    return [];
  }
}

/**
 * Fetch brands using cursor-based pagination
 */
async function fetchBrandsWithPagination(): Promise<FilterOption[]> {
  const allBrands: FilterOption[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;
  let pageCount = 0;
  const maxPages = 20;

  while (hasNextPage && pageCount < maxPages) {
    pageCount++;
    if (process.env.NODE_ENV === 'development') {
      console.log(`getBrands pagination: Fetching page ${pageCount}, cursor: ${afterCursor}`);
    }

    try {
      const result: ApolloQueryResult<BrandQueryResponse> = await getClient().query<BrandQueryResponse>({
        query: GET_BRANDS_PAGE,
        variables: {
          first: 100,
          after: afterCursor,
        },
        fetchPolicy: 'network-only',
      });

      const nodes = result.data?.productBrands?.nodes || [];
      const pageInfo = result.data?.productBrands?.pageInfo;

      if (process.env.NODE_ENV === 'development') {
        console.log(`getBrands page ${pageCount}: got ${nodes.length} nodes, hasNextPage: ${pageInfo?.hasNextPage}`);
      }

      allBrands.push(...nodes);

      hasNextPage = pageInfo?.hasNextPage === true;
      afterCursor = pageInfo?.endCursor || null;

      if (nodes.length === 0) break;
    } catch (queryError) {
      console.error(`getBrands: Error fetching page ${pageCount}:`, queryError);
      break;
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`getBrands pagination: Total ${allBrands.length} brands in ${pageCount} pages`);
  }
  return allBrands;
}

/**
 * Get all product materials for filtering
 * Materials are stored as a custom taxonomy (product_material)
 */
export async function getMaterials(): Promise<FilterOption[]> {
  try {
    const { data } = await getClient().query({
      query: GET_ALL_MATERIALS,
      fetchPolicy: 'no-cache',
    });

    const nodes = data?.productMaterials?.nodes || [];

    return nodes
      .filter((material: FilterOption) => material.count && material.count > 0)
      .map((material: FilterOption) => ({
        id: material.id,
        name: material.name,
        slug: material.slug,
        count: material.count,
      }))
      .sort((a: FilterOption, b: FilterOption) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching materials:', error);
    return [];
  }
}

/**
 * Get global product attributes (color) for filtering
 * Note: Material is now a separate taxonomy, use getMaterials() instead
 */
export async function getGlobalAttributes(): Promise<{
  colors: FilterOption[];
  materials: FilterOption[];
}> {
  try {
    // Fetch colors and materials in parallel
    const [colorResult, materials] = await Promise.all([
      getClient().query({ query: GET_GLOBAL_ATTRIBUTES, fetchPolicy: 'no-cache' }),
      getMaterials(),
    ]);

    const colorNodes = colorResult.data?.allPaColor?.nodes || [];

    const colors = colorNodes
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

// Brand interface with additional details
export interface Brand {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

/**
 * Get a single brand by slug
 */
export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  try {
    const { data } = await getClient().query({
      query: GET_BRAND_BY_SLUG,
      variables: { slug },
      fetchPolicy: 'no-cache',
    });

    const brand = data?.productBrand;
    if (!brand) return null;

    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      count: brand.count || 0,
      description: brand.description || null,
    };
  } catch (error) {
    console.error('Error fetching brand by slug:', error);
    return null;
  }
}

/**
 * Get products by brand slug
 */
export async function getProductsByBrand(
  brandSlug: string,
  limit = 24
): Promise<UnifiedProduct[]> {
  const result = await getFilteredProducts({
    limit,
    brand: brandSlug,
  });
  return result.products;
}
