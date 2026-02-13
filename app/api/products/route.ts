import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts, getFilteredProducts, searchProducts, UnifiedProduct, FilterOption } from '@/lib/products/combined-service';
import { parseIntSafe, parseFloatSafe } from '@/lib/api/validation';
import { sortProductsByPriority, sortWithOutOfStockLast } from '@/lib/utils/product-sort';

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
    // Extract brands from productBrands taxonomy
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

    // Extract materials from productMaterials taxonomy
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

    // Extract colors from attributes
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

  // Convert maps to arrays and sort by name
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

    // Check for dimension/weight filters (these are done client-side)
    const hasDimensionFilters = (minLength !== undefined && minLength > 0) ||
                                 (maxLength !== undefined && maxLength < 24) ||
                                 (minWeight !== undefined && minWeight > 0) ||
                                 (maxWeight !== undefined && maxWeight < 10);

    // Determine if we need filtered query (DB-level filtering) or basic query
    const hasFilters = minPrice !== undefined || maxPrice !== undefined || inStock || onSale || category || brand || color || material || productType;

    let products: UnifiedProduct[];
    let pageInfo;
    let totalCount: number | undefined;
    let availableFilters: ReturnType<typeof extractFilterOptions> | undefined;

    // For dimension filters, we need to fetch more products to filter client-side
    const fetchLimit = hasDimensionFilters ? Math.max(limit * 4, 100) : limit;

    if (search) {
      // Search uses advanced relevance ranking with offset-based pagination
      if (hasFilters) {
        // With filters: fetch search results then filter client-side
        const searchFetchLimit = Math.max(limit * 3, 75);
        const result = await searchProducts(search, { limit: searchFetchLimit, offset: 0 });
        products = result.products;

        // Apply filters to search results
        products = products.filter((product) => {
          // Category filter
          if (category && !product.categories.some(c => c.slug === category)) {
            return false;
          }

          // Brand filter (check productBrands taxonomy)
          if (brand) {
            const productBrand = product.brands?.find(b => b.slug === brand);
            if (!productBrand) return false;
          }

          // Price filter
          const productPrice = parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0');
          if (minPrice !== undefined && minPrice > 0 && productPrice < minPrice) {
            return false;
          }
          if (maxPrice !== undefined && maxPrice < 10000 && productPrice > maxPrice) {
            return false;
          }

          // Stock filter
          if (inStock && product.stockStatus !== 'IN_STOCK') {
            return false;
          }

          // On sale filter
          if (onSale && !product.onSale) {
            return false;
          }

          // Color filter (check attributes)
          if (color) {
            const colorAttr = product.attributes?.find(a => a.name.toLowerCase() === 'color');
            if (!colorAttr || !colorAttr.options.some(o => o.toLowerCase() === color.toLowerCase())) {
              return false;
            }
          }

          // Material filter (check productMaterials taxonomy)
          if (material) {
            const productMaterial = product.materials?.find(m => m.slug === material);
            if (!productMaterial) return false;
          }

          // Product type filter
          if (productType && product.type !== productType.toUpperCase()) {
            return false;
          }

          return true;
        });

        // Track total count and extract available filters before pagination
        totalCount = products.length;
        availableFilters = extractFilterOptions(products);

        // Apply offset-based pagination after filtering
        const startIndex = offset;
        const endIndex = offset + limit;
        const paginatedProducts = products.slice(startIndex, endIndex);

        pageInfo = {
          hasNextPage: endIndex < totalCount,
          endCursor: null, // Search uses offset, not cursor
        };
        products = paginatedProducts;
      } else {
        // Without filters: pass offset directly to searchProducts for efficient pagination
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
      // Use DB-level filtering for price, stock, sale, category, and taxonomy filters
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

      // Apply product type filter before pagination (not available via GraphQL)
      if (productType) {
        const upperType = productType.toUpperCase();
        filteredProducts = filteredProducts.filter(p => p.type === upperType);
      }

      // Extract available filter options from filtered products
      availableFilters = extractFilterOptions(filteredProducts);
      totalCount = filteredProducts.length;

      // Paginate the results
      products = filteredProducts.slice(0, limit);
      pageInfo = {
        hasNextPage: filteredProducts.length > limit || result.pageInfo.hasNextPage,
        endCursor: result.pageInfo.endCursor,
      };
    } else {
      // No filters - use basic query
      const result = await getAllProducts({ limit: fetchLimit, after });
      products = result.products;
      pageInfo = result.pageInfo;
    }

    // Apply dimension/weight filters client-side (these aren't available via GraphQL)
    if (hasDimensionFilters) {
      products = products.filter((product) => {
        // Get product dimensions from attributes or meta
        const productLength = getProductDimension(product, 'length');
        const productWeight = getProductWeight(product);

        // Apply length filter
        if (minLength !== undefined && minLength > 0) {
          if (productLength === null || productLength < minLength) return false;
        }
        if (maxLength !== undefined && maxLength < 24) {
          if (productLength === null || productLength > maxLength) return false;
        }

        // Apply weight filter
        if (minWeight !== undefined && minWeight > 0) {
          if (productWeight === null || productWeight < minWeight) return false;
        }
        if (maxWeight !== undefined && maxWeight < 10) {
          if (productWeight === null || productWeight > maxWeight) return false;
        }

        return true;
      });

      // Limit results after filtering
      products = products.slice(0, limit);

      // Update pageInfo since we filtered client-side
      pageInfo = {
        hasNextPage: products.length >= limit,
        endCursor: pageInfo?.endCursor,
      };
    }

    // Apply sorting (done client-side as GraphQL orderby is limited)
    switch (sort) {
      case 'price-asc':
        products.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceA - priceB;
        });
        // Push out-of-stock to end while preserving price sort within each group
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
        products.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
        products = sortWithOutOfStockLast(products);
        break;
      default:
        // 'newest' - apply full priority sort (stock + source priority)
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

    // CDN/edge caching: cache for 5 min, serve stale up to 1 hour while revalidating
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

/**
 * Extract product length from product data
 * Looks for length in various places: dimensions, attributes, description
 */
function getProductDimension(product: UnifiedProduct, dimension: 'length' | 'width' | 'height'): number | null {
  // Check if product has dimensions in the expected fields
  const productAny = product as any;

  // Check direct dimension fields
  if (productAny[dimension]) {
    const value = parseFloat(productAny[dimension]);
    if (!isNaN(value)) return value;
  }

  // Check dimensions object
  if (productAny.dimensions?.[dimension]) {
    const value = parseFloat(productAny.dimensions[dimension]);
    if (!isNaN(value)) return value;
  }

  // Try to extract from description
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

/**
 * Extract product weight from product data
 * Returns weight in lbs
 */
function getProductWeight(product: UnifiedProduct): number | null {
  const productAny = product as any;

  // Check direct weight field
  if (productAny.weight) {
    const value = parseFloat(productAny.weight);
    if (!isNaN(value)) return value;
  }

  // Check dimensions object
  if (productAny.dimensions?.weight) {
    const value = parseFloat(productAny.dimensions.weight);
    if (!isNaN(value)) return value;
  }

  // Try to extract from description
  if (product.description) {
    // Weight in lbs
    const lbsMatch = product.description.match(/weight[:\s]+(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?\.?)/i);
    if (lbsMatch && lbsMatch[1]) {
      const value = parseFloat(lbsMatch[1]);
      if (!isNaN(value) && value > 0 && value < 100) return value;
    }

    // Weight in oz (convert to lbs)
    const ozMatch = product.description.match(/weight[:\s]+(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)/i);
    if (ozMatch && ozMatch[1]) {
      const value = parseFloat(ozMatch[1]) / 16; // Convert oz to lbs
      if (!isNaN(value) && value > 0 && value < 100) return value;
    }
  }

  return null;
}
