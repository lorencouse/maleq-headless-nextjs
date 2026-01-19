import { NextRequest, NextResponse } from 'next/server';
import { searchProducts, getProductCategories } from '@/lib/products/combined-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    if (!query || query.length < 2) {
      return NextResponse.json({
        products: [],
        categories: [],
      });
    }

    // Search products and filter categories that match
    const [products, allCategories] = await Promise.all([
      searchProducts(query, limit),
      getProductCategories(),
    ]);

    // Filter categories that match the search term
    const matchingCategories = allCategories
      .filter((cat) => cat.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 3)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
      }));

    // Format products for suggestions
    const productSuggestions = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      image: p.image?.url || null,
    }));

    return NextResponse.json({
      products: productSuggestions,
      categories: matchingCategories,
    });
  } catch (error) {
    console.error('Search error:', error);

    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
