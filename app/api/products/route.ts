import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts } from '@/lib/products/combined-service';

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

    // Fetch products from the service
    let result = await getAllProducts({
      limit,
      after,
      category,
      search,
    });

    let { products } = result;
    const { pageInfo } = result;

    // Apply additional filters that GraphQL doesn't support directly
    if (minPrice !== undefined || maxPrice !== undefined) {
      products = products.filter((p) => {
        const price = parseFloat(p.price?.replace(/[^0-9.]/g, '') || '0');
        if (minPrice !== undefined && price < minPrice) return false;
        if (maxPrice !== undefined && price > maxPrice) return false;
        return true;
      });
    }

    if (inStock) {
      products = products.filter((p) => p.stockStatus === 'IN_STOCK');
    }

    if (onSale) {
      products = products.filter((p) => p.onSale);
    }

    // Apply sorting
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
      // 'newest' is default, keep original order
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
