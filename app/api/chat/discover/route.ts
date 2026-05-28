import { NextRequest, NextResponse } from 'next/server';
import { queryProductIndex } from '@/lib/products/product-index';
import { searchBlogPosts } from '@/lib/blog/blog-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_BANDS = [
  { id: 'under-25', label: 'Under $25', min: undefined, max: 25 },
  { id: '25-50', label: '$25–$50', min: 25, max: 50 },
  { id: '50-100', label: '$50–$100', min: 50, max: 100 },
  { id: '100-plus', label: '$100+', min: 100, max: undefined },
] as const;

type FilterInput = {
  material?: string;
  color?: string;
  priceBand?: string;
};

type DiscoverResult = {
  query: string;
  filters: FilterInput;
  products: {
    id: number;
    name: string;
    url: string;
    price: number | null;
    onSale: boolean;
    brand: string | null;
    material: string | null;
    inStock: boolean;
    image: string | null;
    rating: number | null;
    reviewCount: number;
  }[];
  totalMatches: number;
  articles: {
    title: string;
    url: string;
    excerpt: string | null;
  }[];
  facets: {
    materials: { slug: string; name: string; count: number }[];
    colors: { slug: string; name: string; count: number }[];
    priceBands: { id: string; label: string }[];
  };
};

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const body = payload as { query?: unknown; filters?: unknown };
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  const filtersRaw = (body.filters ?? {}) as Record<string, unknown>;
  const filters: FilterInput = {
    material: typeof filtersRaw.material === 'string' ? filtersRaw.material : undefined,
    color: typeof filtersRaw.color === 'string' ? filtersRaw.color : undefined,
    priceBand: typeof filtersRaw.priceBand === 'string' ? filtersRaw.priceBand : undefined,
  };

  const band = filters.priceBand
    ? PRICE_BANDS.find((b) => b.id === filters.priceBand)
    : undefined;

  // Products + facets via the in-memory index
  const productResult = await queryProductIndex({
    search: query,
    material: filters.material,
    color: filters.color,
    minPrice: band?.min,
    maxPrice: band?.max,
    inStock: true,
    sort: 'popularity',
    limit: 4,
  });

  // Blog articles by free-text search of the query
  let articles: DiscoverResult['articles'] = [];
  try {
    const blog = await searchBlogPosts(query, { first: 3 });
    articles = blog.posts.slice(0, 3).map((p) => ({
      title: p.title ?? 'Untitled',
      url: `/guides/${p.slug}`,
      excerpt: stripHtml(p.excerpt)?.slice(0, 160) ?? null,
    }));
  } catch (err) {
    console.error('[chat/discover] blog search failed:', err);
  }

  const result: DiscoverResult = {
    query,
    filters,
    totalMatches: productResult.total,
    products: productResult.products.map((p) => ({
      id: p.id,
      name: p.name,
      url: `/product/${p.slug}`,
      price: p.price,
      onSale: p.onSale,
      brand: p.brandName,
      material: p.materialName,
      inStock: p.stockStatus === 'IN_STOCK',
      image: p.imageUrl,
      rating: p.averageRating > 0 ? Number(p.averageRating.toFixed(1)) : null,
      reviewCount: p.reviewCount,
    })),
    articles,
    facets: {
      materials: productResult.facets.materials.slice(0, 5),
      colors: productResult.facets.colors.slice(0, 5),
      priceBands: PRICE_BANDS.map((b) => ({ id: b.id, label: b.label })),
    },
  };

  return NextResponse.json(result);
}
