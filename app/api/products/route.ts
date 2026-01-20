import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts, getFilteredProducts } from '@/lib/products/combined-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const limit = parseInt(searchParams.get('limit') || '24', 10);
    const after = searchParams.get('after') || undefined;
    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;
    const minPrice = searchParams.get('minPrice') ? parseFloat(searchParams.get('minPrice')!) : undefined;
    const maxPrice = searchParams.get('maxPrice') ? parseFloat(searchParams.get('maxPrice')!) : undefined;
    const inStock = searchParams.get('inStock') === 'true';
    const onSale = searchParams.get('onSale') === 'true';
    const sort = searchParams.get('sort') || 'newest';

    // Determine if we need filtered query (DB-level filtering) or basic query
    const hasFilters = minPrice !== undefined || maxPrice !== undefined || inStock || onSale || category;

    let products;
    let pageInfo;

    if (search) {
      // Search query uses basic getAllProducts
      const result = await getAllProducts({ limit, after, search });
      products = result.products;
      pageInfo = result.pageInfo;
    } else if (hasFilters) {
      // Use DB-level filtering for price, stock, sale, and category filters
      const result = await getFilteredProducts({
        limit,
        after,
        category,
        minPrice,
        maxPrice,
        inStock,
        onSale,
      });
      products = result.products;
      pageInfo = result.pageInfo;
    } else {
      // No filters - use basic query
      const result = await getAllProducts({ limit, after });
      products = result.products;
      pageInfo = result.pageInfo;
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
