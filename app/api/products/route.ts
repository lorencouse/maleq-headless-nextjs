import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts, getFilteredProducts, UnifiedProduct } from '@/lib/products/combined-service';
import { parseIntSafe, parseFloatSafe } from '@/lib/api/validation';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const limit = parseIntSafe(searchParams.get('limit'), 24, 1, 100);
    const after = searchParams.get('after') || undefined;
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
    const sort = searchParams.get('sort') || 'newest';

    // Check for dimension/weight filters (these are done client-side)
    const hasDimensionFilters = (minLength !== undefined && minLength > 0) ||
                                 (maxLength !== undefined && maxLength < 24) ||
                                 (minWeight !== undefined && minWeight > 0) ||
                                 (maxWeight !== undefined && maxWeight < 10);

    // Determine if we need filtered query (DB-level filtering) or basic query
    const hasFilters = minPrice !== undefined || maxPrice !== undefined || inStock || onSale || category || brand || color || material;

    let products: UnifiedProduct[];
    let pageInfo;

    // For dimension filters, we need to fetch more products to filter client-side
    const fetchLimit = hasDimensionFilters ? Math.max(limit * 4, 100) : limit;

    if (search) {
      // Search query uses basic getAllProducts
      const result = await getAllProducts({ limit: fetchLimit, after, search });
      products = result.products;
      pageInfo = result.pageInfo;
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
      products = result.products;
      pageInfo = result.pageInfo;
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
        break;
      case 'price-desc':
        products.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceB - priceA;
        });
        break;
      case 'name-asc':
        products.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        products.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'popularity':
        products.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
        break;
      // 'newest' is default, keep original order from DB
    }

    return NextResponse.json({
      products,
      pageInfo,
      total: products.length,
    });
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
