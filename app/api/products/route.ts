import { NextRequest, NextResponse } from 'next/server';
import { getAllProducts } from '@/lib/products/combined-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '12', 10);
    const after = searchParams.get('after') || undefined;
    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;

    const { products, pageInfo } = await getAllProducts({
      limit,
      after,
      category,
      search,
    });

    return NextResponse.json({
      products,
      pageInfo,
    });
  } catch (error) {
    console.error('Error fetching products:', error);

    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
