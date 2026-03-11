import Link from 'next/link';
import { Suspense } from 'react';
import { Metadata } from 'next';
import {
  getAllProducts,
  getHierarchicalCategories,
  getBrands,
  getGlobalAttributes,
  getFilteredProducts,
  searchProducts,
} from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import { isMySQLConfigured } from '@/lib/db/pool';
import {
  queryProductIndex,
  type FacetOption,
} from '@/lib/products/product-index';
import { indexEntriesToUnifiedProducts } from '@/lib/products/index-to-unified';
import ShopPageClient from '@/components/shop/ShopPageClient';
import ShopHero from '@/components/shop/ShopHero';
import FeaturedCategories from '@/components/shop/FeaturedCategories';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';
import DidYouMean from '@/components/search/DidYouMean';
import DiscountTierBanner from '@/components/ui/DiscountTierBanner';

interface ShopPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  searchParams,
}: ShopPageProps): Promise<Metadata> {
  const params = await searchParams;
  const searchQuery = typeof params.q === 'string' ? params.q : undefined;

  if (searchQuery) {
    return {
      title: `Search results for "${searchQuery}"`,
      description: `Browse search results for "${searchQuery}" in our collection of quality products.`,
      robots: { index: false },
    };
  }

  const description =
    'Browse our collection of quality products. Filter by category, price, and more.';

  return {
    title: 'Shop',
    description,
    openGraph: {
      title: 'Shop | Male Q',
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: 'Shop | Male Q',
      description,
    },
    alternates: {
      canonical: '/shop',
    },
  };
}

// Dynamic page: uses searchParams for filtering/search.
// Data fetching uses unstable_cache and in-memory product index, so no perf penalty.

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;

  // Parse search query and filter params from URL
  const searchQuery = typeof params.q === 'string' ? params.q : undefined;
  const category =
    typeof params.category === 'string' ? params.category : undefined;
  const brand = typeof params.brand === 'string' ? params.brand : undefined;
  const color = typeof params.color === 'string' ? params.color : undefined;
  const material =
    typeof params.material === 'string' ? params.material : undefined;
  const minPrice =
    typeof params.minPrice === 'string'
      ? parseFloat(params.minPrice)
      : undefined;
  const maxPrice =
    typeof params.maxPrice === 'string'
      ? parseFloat(params.maxPrice)
      : undefined;
  const inStock = params.inStock === 'true';
  const onSale = params.onSale === 'true';

  // Check if any filters are active (excluding search)
  const hasFilters =
    category ||
    brand ||
    color ||
    material ||
    (minPrice !== undefined && minPrice > 0) ||
    (maxPrice !== undefined && maxPrice < 500) ||
    inStock ||
    onSale;

  // Check if user is in "browse mode" (has used filters/search at any point)
  // The 'browse' param is set when user clears all filters to keep hero hidden
  const browseMode = params.browse === '1';

  // Check if search or filters are active
  const hasSearchOrFilters = searchQuery || hasFilters || browseMode;

  // ─── Try in-memory product index (MySQL) for product data ───
  const useIndex = isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql';

  type ProductsResult = {
    products: Awaited<ReturnType<typeof getAllProducts>>['products'];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    total?: number;
    availableFilters?: Awaited<
      ReturnType<typeof searchProducts>
    >['availableFilters'];
    suggestions?: string[];
  };

  let productsResult: ProductsResult | null = null;
  let indexFacets: {
    brands: FacetOption[];
    materials: FacetOption[];
    colors: FacetOption[];
    categories: FacetOption[];
  } | null = null;

  if (useIndex) {
    try {
      // Main product query
      const result = await queryProductIndex({
        category,
        brand,
        material,
        color,
        minPrice,
        maxPrice,
        inStock,
        onSale,
        search: searchQuery,
        sort: 'newest',
        limit: 24,
        offset: 0,
      });

      productsResult = {
        products: indexEntriesToUnifiedProducts(result.products),
        pageInfo: { hasNextPage: result.total > 24, endCursor: null },
        total: result.total,
      };
      indexFacets = result.facets;

      // If search returned no results, get suggestions from the existing search system
      if (searchQuery && result.products.length === 0) {
        try {
          const searchResult = await searchProducts(searchQuery, {
            limit: 1,
            offset: 0,
          });
          productsResult.suggestions = searchResult.suggestions;
        } catch {
          // Ignore suggestion errors
        }
      }
    } catch (err) {
      console.error('[shop] Index query failed, falling back to GraphQL:', err);
      // Fall through to GraphQL below
      productsResult = null;
    }
  }

  // GraphQL fallback
  if (!productsResult) {
    if (searchQuery) {
      const searchResult = await searchProducts(searchQuery, {
        limit: 24,
        offset: 0,
      });
      productsResult = {
        products: searchResult.products,
        pageInfo: {
          hasNextPage: searchResult.pageInfo.hasNextPage,
          endCursor: null,
        },
        total: searchResult.pageInfo.total,
        availableFilters: searchResult.availableFilters,
        suggestions: searchResult.suggestions,
      };
    } else if (hasFilters) {
      const isCategoryOnly =
        category &&
        !brand &&
        !color &&
        !material &&
        !(minPrice !== undefined && minPrice > 0) &&
        !(maxPrice !== undefined && maxPrice < 500) &&
        !inStock &&
        !onSale;

      if (isCategoryOnly) {
        const categoryResult = await getFilteredProducts({
          limit: 24,
          category,
        });
        productsResult = {
          products: categoryResult.products,
          pageInfo: categoryResult.pageInfo,
        };
      } else {
        const filteredResult = await getFilteredProducts({
          limit: 24,
          category,
          brand,
          color,
          material,
          minPrice,
          maxPrice,
          inStock,
          onSale,
        });
        productsResult = filteredResult;
      }
    } else {
      productsResult = await getAllProducts({ limit: 24 });
    }
  }

  const {
    products: rawProducts,
    pageInfo,
    total: searchTotal,
    availableFilters,
    suggestions,
  } = productsResult;
  const products = sortProductsByPriority(rawProducts);

  // Also fetch sale products for featured section (only when no search/filters active)
  let saleProductsPromise: Promise<{ products: typeof rawProducts }>;
  if (!hasSearchOrFilters) {
    if (useIndex) {
      saleProductsPromise = queryProductIndex({
        onSale: true,
        inStock: true,
        limit: 8,
        sort: 'popularity',
      })
        .then((r) => ({ products: indexEntriesToUnifiedProducts(r.products) }))
        .catch(() =>
          getFilteredProducts({ limit: 8, onSale: true, inStock: true }),
        );
    } else {
      saleProductsPromise = getFilteredProducts({
        limit: 8,
        onSale: true,
        inStock: true,
      });
    }
  } else {
    saleProductsPromise = Promise.resolve({ products: [] });
  }

  // Get categories (always needed for nav tree), brands, and attributes
  const [
    { products: saleProducts },
    categories,
    globalBrands,
    { colors: globalColors, materials: globalMaterials },
  ] = await Promise.all([
    saleProductsPromise,
    getHierarchicalCategories(),
    // Skip GraphQL brand/attribute fetches when index provides facets
    indexFacets ? Promise.resolve([]) : getBrands(),
    indexFacets
      ? Promise.resolve({ colors: [], materials: [] })
      : getGlobalAttributes(),
  ]);

  // Use index facets when available, then search-specific, then global
  const facetToFilterOption = (f: FacetOption) => ({
    id: f.slug,
    name: f.name,
    slug: f.slug,
    count: f.count,
  });
  const brands = indexFacets
    ? indexFacets.brands.map(facetToFilterOption)
    : (availableFilters?.brands ?? globalBrands);
  const colors = indexFacets
    ? indexFacets.colors.map(facetToFilterOption)
    : (availableFilters?.colors ?? globalColors);
  const materials = indexFacets
    ? indexFacets.materials.map(facetToFilterOption)
    : (availableFilters?.materials ?? globalMaterials);

  // Helper to find category count recursively
  function findCategoryCount(
    cats: typeof categories,
    slug: string,
  ): number | null {
    for (const cat of cats) {
      if (cat.slug === slug) return cat.count;
      if (cat.children.length > 0) {
        const found = findCategoryCount(cat.children, slug);
        if (found !== null) return found;
      }
    }
    return null;
  }

  // Calculate initial total for display
  // For search: use searchTotal
  // For category filter: use category count from taxonomy
  // For other filters: show current page count (we don't have exact totals)
  let initialTotal: number | undefined = searchTotal;
  if (!initialTotal && category) {
    const categoryCount = findCategoryCount(categories, category);
    if (categoryCount !== null) {
      initialTotal = categoryCount;
    }
  }

  // Show featured sections only when no search or filters are active
  const showFeaturedSections = !hasSearchOrFilters;

  return (
    <div className='max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12'>
      {/* Featured Sections - Only show when no filters */}
      {showFeaturedSections && (
        <>
          {/* Hero Banner with Promos */}
          <ShopHero />

          {/* Featured Categories */}
          <FeaturedCategories categories={categories} />

          {/* Discount Tiers */}
          <DiscountTierBanner variant='compact' className='my-6' />

          {/* Section Divider */}
          <div className='border-t border-border my-8' />
        </>
      )}

      {/* Show featured sections link when in browse mode */}
      {!showFeaturedSections && (
        <Link
          href='/shop'
          className='inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4'
        >
          <svg
            className='w-4 h-4'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
            />
          </svg>
          Show featured sections
        </Link>
      )}

      {/* Page Header */}
      <div id='products' className='mb-6'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2'>
          <h1 className='text-2xl sm:text-3xl font-bold text-foreground'>
            {searchQuery
              ? `Search results for "${searchQuery}"`
              : hasFilters
                ? 'Filtered Results'
                : 'All Products'}
          </h1>
          <Suspense
            fallback={
              <div className='w-full max-w-md h-11 bg-muted rounded-lg animate-pulse' />
            }
          >
            <ShopSearch />
          </Suspense>
        </div>

        {/* Did you mean? suggestions when no results */}
        {suggestions && searchQuery && products.length === 0 && (
          <DidYouMean suggestions={suggestions} basePath='/shop' />
        )}

        <p className='text-muted-foreground'>
          {searchQuery
            ? `Found ${initialTotal ?? products.length} products`
            : hasFilters
              ? `Showing ${products.length} products matching your criteria`
              : 'Browse our complete collection of premium products'}
        </p>
      </div>

      {/* Shop Content with Filters */}
      <Suspense fallback={<ShopLoadingSkeleton />}>
        <ShopPageClient
          initialProducts={products}
          categories={categories}
          brands={brands}
          colors={colors}
          materials={materials}
          hasMore={pageInfo.hasNextPage}
          initialCursor={pageInfo.endCursor}
          searchQuery={searchQuery}
          initialTotal={initialTotal}
        />
      </Suspense>
    </div>
  );
}

function ShopLoadingSkeleton() {
  return (
    <div className='flex flex-col lg:flex-row gap-8'>
      {/* Filter Skeleton */}
      <aside className='hidden lg:block w-64 flex-shrink-0'>
        <div className='space-y-4'>
          <div className='h-6 bg-muted rounded w-24 animate-pulse' />
          <div className='space-y-2'>
            {[...Array(5)].map((_, i) => (
              <div key={i} className='h-10 bg-muted rounded animate-pulse' />
            ))}
          </div>
        </div>
      </aside>

      {/* Products Skeleton */}
      <div className='flex-1'>
        <div className='flex justify-between mb-6'>
          <div className='h-10 bg-muted rounded w-32 animate-pulse' />
          <div className='h-10 bg-muted rounded w-40 animate-pulse' />
        </div>
        <div className='grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-6'>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className='bg-card border border-border rounded-lg overflow-hidden'
            >
              <div className='aspect-square bg-muted animate-pulse' />
              <div className='p-4 space-y-2'>
                <div className='h-4 bg-muted rounded w-3/4 animate-pulse' />
                <div className='h-4 bg-muted rounded w-1/2 animate-pulse' />
                <div className='h-6 bg-muted rounded w-1/4 animate-pulse' />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
