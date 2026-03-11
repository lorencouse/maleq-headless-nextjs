import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts, getFilteredProducts, searchProducts, UnifiedProduct, FilterOption } from '@/lib/products/combined-service';
import { parseIntSafe, parseFloatSafe } from '@/lib/api/validation';
import { sortProductsByPriority, sortWithOutOfStockLast } from '@/lib/utils/product-sort';
import { isMySQLConfigured } from '@/lib/db/pool';
import { queryProductIndex, type FacetOption } from '@/lib/products/product-index';
import { indexEntriesToUnifiedProducts } from '@/lib/products/index-to-unified';

type ProductWithDimensions = UnifiedProduct & {
  length?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  weight?: string | number | null;
  dimensions?: Partial<Record<'length' | 'width' | 'height' | 'weight', string | number | null>>;
};

/**
 * Extract available filter options from a list of products
 * Returns unique brands, materials, and colors with counts
 */
function extractFilterOptions(products: UnifiedProduct[]): {
  availableBrands: FilterOption[];
  availableMaterials: FilterOption[];
  availableColors: FilterOption[];
} {
  const brandMap = new Map<string, { name: string; slug: string; count: number }>();
  const materialMap = new Map<string, { name: string; slug: string; count: number }>();
  const colorMap = new Map<string, { name: string; slug: string; count: number }>();

  for (const product of products) {
    if (product.brands) {
      for (const brand of product.brands) {
        const existing = brandMap.get(brand.slug);
        if (existing) {
          existing.count++;
        } else {
          brandMap.set(brand.slug, { name: brand.name, slug: brand.slug, count: 1 });
        }
      }
    }

    if (product.materials) {
      for (const material of product.materials) {
        const existing = materialMap.get(material.slug);
        if (existing) {
          existing.count++;
        } else {
          materialMap.set(material.slug, { name: material.name, slug: material.slug, count: 1 });
        }
      }
    }

    if (product.attributes) {
      for (const attr of product.attributes) {
        const attrNameLower = attr.name.toLowerCase();

        if (attrNameLower === 'color' || attrNameLower === 'pa_color') {
          for (const option of attr.options) {
            const slug = option.toLowerCase().replace(/\s+/g, '-');
            const existing = colorMap.get(slug);
            if (existing) {
              existing.count++;
            } else {
              colorMap.set(slug, { name: option, slug, count: 1 });
            }
          }
        }
      }
    }
  }

  const availableBrands = Array.from(brandMap.values())
    .map(b => ({ id: b.slug, name: b.name, slug: b.slug, count: b.count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const availableMaterials = Array.from(materialMap.values())
    .map(m => ({ id: m.slug, name: m.name, slug: m.slug, count: m.count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const availableColors = Array.from(colorMap.values())
    .map(c => ({ id: c.slug, name: c.name, slug: c.slug, count: c.count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { availableBrands, availableMaterials, availableColors };
}

/** Convert index FacetOption[] to FilterOption[] */
function facetsToFilterOptions(facets: FacetOption[]): FilterOption[] {
  return facets.map(f => ({ id: f.slug, name: f.name, slug: f.slug, count: f.count }));
}

/** Check if we should use the in-memory MySQL index */
function shouldUseProductIndex(): boolean {
  return isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql';
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const limit = parseIntSafe(searchParams.get('limit'), 24, 1, 100);
    const after = searchParams.get('after') || undefined;
    const offset = parseIntSafe(searchParams.get('offset'), 0, 0, 10000);
    const category = searchParams.get('category') || undefined;
    const brand = searchParams.get('brand') || undefined;
    const color = searchParams.get('color') || undefined;
    const material = searchParams.get('material') || undefined;
    const search = searchParams.get('search') || undefined;
    const minPriceRaw = searchParams.get('minPrice');
    const maxPriceRaw = searchParams.get('maxPrice');
    const minLengthRaw = searchParams.get('minLength');
    const maxLengthRaw = searchParams.get('maxLength');
    const minWeightRaw = searchParams.get('minWeight');
    const maxWeightRaw = searchParams.get('maxWeight');

    const minPrice = minPriceRaw ? parseFloatSafe(minPriceRaw, 0, 0) : undefined;
    const maxPrice = maxPriceRaw ? parseFloatSafe(maxPriceRaw, 10000, 0) : undefined;
    const minLength = minLengthRaw ? parseFloatSafe(minLengthRaw, 0, 0) : undefined;
    const maxLength = maxLengthRaw ? parseFloatSafe(maxLengthRaw, 24, 0) : undefined;
    const minWeight = minWeightRaw ? parseFloatSafe(minWeightRaw, 0, 0) : undefined;
    const maxWeight = maxWeightRaw ? parseFloatSafe(maxWeightRaw, 10, 0) : undefined;
    const inStock = searchParams.get('inStock') === 'true';
    const onSale = searchParams.get('onSale') === 'true';
    const productType = searchParams.get('productType') || undefined;
    const sort = searchParams.get('sort') || 'newest';

    const hasDimensionFilters = (minLength !== undefined && minLength > 0) ||
                                 (maxLength !== undefined && maxLength < 24) ||
                                 (minWeight !== undefined && minWeight > 0) ||
                                 (maxWeight !== undefined && maxWeight < 10);

    // ─── Try in-memory product index (MySQL) ───
    if (shouldUseProductIndex()) {
      try {
        const result = await queryProductIndex({
          category,
          brand,
          material,
          color,
          minPrice,
          maxPrice,
          inStock,
          onSale,
          productType,
          search,
          sort,
          limit,
          offset,
        });

        const products = indexEntriesToUnifiedProducts(result.products);

        const response = NextResponse.json({
          products,
          pageInfo: {
            hasNextPage: offset + limit < result.total,
            endCursor: null,
          },
          total: result.total,
          availableBrands: facetsToFilterOptions(result.facets.brands),
          availableMaterials: facetsToFilterOptions(result.facets.materials),
          availableColors: facetsToFilterOptions(result.facets.colors),
        });

        response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
        return response;
      } catch (indexError) {
        console.error('[api/products] Index query failed, falling back to GraphQL:', indexError);
        // Fall through to GraphQL
      }
    }

    // ─── GraphQL fallback ───
    const hasFilters = minPrice !== undefined || maxPrice !== undefined || inStock || onSale || category || brand || color || material || productType;

    let products: UnifiedProduct[];
    let pageInfo;
    let totalCount: number | undefined;
    let availableFilters: ReturnType<typeof extractFilterOptions> | undefined;

    const fetchLimit = hasDimensionFilters ? Math.max(limit * 4, 100) : limit;

    if (search) {
      if (hasFilters) {
        const searchFetchLimit = Math.max(limit * 3, 75);
        const result = await searchProducts(search, { limit: searchFetchLimit, offset: 0 });
        products = result.products;

        products = products.filter((product) => {
          if (category && !product.categories.some(c => c.slug === category)) {
            return false;
          }
          if (brand) {
            const productBrand = product.brands?.find(b => b.slug === brand);
            if (!productBrand) return false;
          }
          const productPrice = parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0');
          if (minPrice !== undefined && minPrice > 0 && productPrice < minPrice) {
            return false;
          }
          if (maxPrice !== undefined && maxPrice < 10000 && productPrice > maxPrice) {
            return false;
          }
          if (inStock && product.stockStatus !== 'IN_STOCK') {
            return false;
          }
          if (onSale && !product.onSale) {
            return false;
          }
          if (color) {
            const colorAttr = product.attributes?.find(a => a.name.toLowerCase() === 'color');
            if (!colorAttr || !colorAttr.options.some(o => o.toLowerCase() === color.toLowerCase())) {
              return false;
            }
          }
          if (material) {
            const productMaterial = product.materials?.find(m => m.slug === material);
            if (!productMaterial) return false;
          }
          if (productType && product.type !== productType.toUpperCase()) {
            return false;
          }
          return true;
        });

        totalCount = products.length;
        availableFilters = extractFilterOptions(products);

        const startIndex = offset;
        const endIndex = offset + limit;
        const paginatedProducts = products.slice(startIndex, endIndex);

        pageInfo = {
          hasNextPage: endIndex < totalCount,
          endCursor: null,
        };
        products = paginatedProducts;
      } else {
        const result = await searchProducts(search, { limit, offset });
        products = result.products;
        totalCount = result.pageInfo.total;
        availableFilters = result.availableFilters ? {
          availableBrands: result.availableFilters.brands,
          availableMaterials: result.availableFilters.materials,
          availableColors: result.availableFilters.colors,
        } : undefined;
        pageInfo = {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: null,
        };
      }
    } else if (hasFilters) {
      const result = await getFilteredProducts({
        limit: fetchLimit,
        after,
        category,
        brand,
        color,
        material,
        minPrice,
        maxPrice,
        inStock,
        onSale,
      });

      let filteredProducts = result.products;

      if (productType) {
        const upperType = productType.toUpperCase();
        filteredProducts = filteredProducts.filter(p => p.type === upperType);
      }

      availableFilters = extractFilterOptions(filteredProducts);
      totalCount = filteredProducts.length;

      products = filteredProducts.slice(0, limit);
      pageInfo = {
        hasNextPage: filteredProducts.length > limit || result.pageInfo.hasNextPage,
        endCursor: result.pageInfo.endCursor,
      };
    } else {
      const result = await getAllProducts({ limit: fetchLimit, after });
      products = result.products;
      pageInfo = result.pageInfo;
    }

    // Apply dimension/weight filters (only in GraphQL path — index doesn't have dimensions)
    if (hasDimensionFilters) {
      products = products.filter((product) => {
        const productLength = getProductDimension(product, 'length');
        const productWeight = getProductWeight(product);

        if (minLength !== undefined && minLength > 0) {
          if (productLength === null || productLength < minLength) return false;
        }
        if (maxLength !== undefined && maxLength < 24) {
          if (productLength === null || productLength > maxLength) return false;
        }
        if (minWeight !== undefined && minWeight > 0) {
          if (productWeight === null || productWeight < minWeight) return false;
        }
        if (maxWeight !== undefined && maxWeight < 10) {
          if (productWeight === null || productWeight > maxWeight) return false;
        }
        return true;
      });

      products = products.slice(0, limit);
      pageInfo = {
        hasNextPage: products.length >= limit,
        endCursor: pageInfo?.endCursor,
      };
    }

    // Apply sorting
    switch (sort) {
      case 'price-asc':
        products.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceA - priceB;
        });
        products = sortWithOutOfStockLast(products);
        break;
      case 'price-desc':
        products.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceB - priceA;
        });
        products = sortWithOutOfStockLast(products);
        break;
      case 'name-asc':
        products.sort((a, b) => a.name.localeCompare(b.name));
        products = sortWithOutOfStockLast(products);
        break;
      case 'name-desc':
        products.sort((a, b) => b.name.localeCompare(a.name));
        products = sortWithOutOfStockLast(products);
        break;
      case 'popularity':
        products.sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
        products = sortWithOutOfStockLast(products);
        break;
      default:
        products = sortProductsByPriority(products);
        break;
    }

    const response = NextResponse.json({
      products,
      pageInfo,
      total: totalCount ?? products.length,
      ...(availableFilters && {
        availableBrands: availableFilters.availableBrands,
        availableMaterials: availableFilters.availableMaterials,
        availableColors: availableFilters.availableColors,
      }),
    });

    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return response;
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}

function getProductDimension(product: UnifiedProduct, dimension: 'length' | 'width' | 'height'): number | null {
  const productWithDimensions = product as ProductWithDimensions;

  if (productWithDimensions[dimension]) {
    const value = parseFloat(String(productWithDimensions[dimension]));
    if (!isNaN(value)) return value;
  }

  if (productWithDimensions.dimensions?.[dimension]) {
    const value = parseFloat(String(productWithDimensions.dimensions[dimension]));
    if (!isNaN(value)) return value;
  }

  if (product.description) {
    const patterns: Record<string, RegExp[]> = {
      length: [
        /length[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
        /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+long/i,
      ],
      width: [
        /width[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
        /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+wide/i,
      ],
      height: [
        /height[:\s]+(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
        /(\d+(?:\.\d+)?)\s*(?:inches?|in\.?)\s+tall/i,
      ],
    };

    for (const pattern of patterns[dimension] || []) {
      const match = product.description.match(pattern);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value > 0 && value < 100) return value;
      }
    }
  }

  return null;
}

function getProductWeight(product: UnifiedProduct): number | null {
  const productWithDimensions = product as ProductWithDimensions;

  if (productWithDimensions.weight) {
    const value = parseFloat(String(productWithDimensions.weight));
    if (!isNaN(value)) return value;
  }

  if (productWithDimensions.dimensions?.weight) {
    const value = parseFloat(String(productWithDimensions.dimensions.weight));
    if (!isNaN(value)) return value;
  }

  if (product.description) {
    const lbsMatch = product.description.match(/weight[:\s]+(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?\.?)/i);
    if (lbsMatch && lbsMatch[1]) {
      const value = parseFloat(lbsMatch[1]);
      if (!isNaN(value) && value > 0 && value < 100) return value;
    }

    const ozMatch = product.description.match(/weight[:\s]+(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)/i);
    if (ozMatch && ozMatch[1]) {
      const value = parseFloat(ozMatch[1]) / 16;
      if (!isNaN(value) && value > 0 && value < 100) return value;
    }
  }

  return null;
}
