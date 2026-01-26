import { Suspense } from 'react';
import { Metadata } from 'next';
import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts, searchProducts } from '@/lib/products/combined-service';
import ShopPageClient from '@/components/shop/ShopPageClient';
import ShopHero from '@/components/shop/ShopHero';
import FeaturedCategories from '@/components/shop/FeaturedCategories';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';

interface ShopPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ searchParams }: ShopPageProps): Promise<Metadata> {
  const params = await searchParams;
  const searchQuery = typeof params.q === 'string' ? params.q : undefined;

  if (searchQuery) {
    return {
      title: `Search results for "${searchQuery}" | Male Q`,
      description: `Browse search results for "${searchQuery}" in our collection of quality products.`,
    };
  }

  return {
    title: 'Shop | Male Q',
    description: 'Browse our collection of quality products. Filter by category, price, and more.',
  };
}

// ISR: Revalidate every 24 hours for fresh product/stock data
export const revalidate = 86400;

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;

  // Parse search query and filter params from URL
  const searchQuery = typeof params.q === 'string' ? params.q : undefined;
  const category = typeof params.category === 'string' ? params.category : undefined;
  const brand = typeof params.brand === 'string' ? params.brand : undefined;
  const color = typeof params.color === 'string' ? params.color : undefined;
  const material = typeof params.material === 'string' ? params.material : undefined;
  const minPrice = typeof params.minPrice === 'string' ? parseFloat(params.minPrice) : undefined;
  const maxPrice = typeof params.maxPrice === 'string' ? parseFloat(params.maxPrice) : undefined;
  const inStock = params.inStock === 'true';
  const onSale = params.onSale === 'true';

  // Check if any filters are active (excluding search)
  const hasFilters = category || brand || color || material ||
    (minPrice !== undefined && minPrice > 0) ||
    (maxPrice !== undefined && maxPrice < 500) ||
    inStock || onSale;

  // Check if user is in "browse mode" (has used filters/search at any point)
  // The 'browse' param is set when user clears all filters to keep hero hidden
  const browseMode = params.browse === '1';

  // Check if search or filters are active
  const hasSearchOrFilters = searchQuery || hasFilters || browseMode;

  // Fetch products based on search query or filters
  let productsResult: {
    products: Awaited<ReturnType<typeof getAllProducts>>['products'];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    total?: number;
    availableFilters?: Awaited<ReturnType<typeof searchProducts>>['availableFilters'];
  };

  if (searchQuery) {
    // Use search with relevance ranking
    const searchResult = await searchProducts(searchQuery, { limit: 24, offset: 0 });
    productsResult = {
      products: searchResult.products,
      pageInfo: { hasNextPage: searchResult.pageInfo.hasNextPage, endCursor: null },
      total: searchResult.pageInfo.total,
      availableFilters: searchResult.availableFilters,
    };
  } else if (hasFilters) {
    // Use filtered query
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
  } else {
    // No search or filters - get all products
    productsResult = await getAllProducts({ limit: 24 });
  }

  const { products, pageInfo, total: initialTotal, availableFilters } = productsResult;

  // Also fetch sale products for featured section (only when no search/filters active)
  const saleProductsPromise = !hasSearchOrFilters
    ? getFilteredProducts({ limit: 8, onSale: true })
    : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } });

  // Get categories, brands, and attributes from WooCommerce
  const [{ products: saleProducts }, categories, globalBrands, { colors: globalColors, materials: globalMaterials }] = await Promise.all([
    saleProductsPromise,
    getHierarchicalCategories(),
    getBrands(),
    getGlobalAttributes(),
  ]);

  // Use search-specific filter options when available, otherwise use global options
  const brands = availableFilters?.brands ?? globalBrands;
  const colors = availableFilters?.colors ?? globalColors;
  const materials = availableFilters?.materials ?? globalMaterials;

  // Show featured sections only when no search or filters are active
  const showFeaturedSections = !hasSearchOrFilters;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Featured Sections - Only show when no filters */}
      {showFeaturedSections && (
        <>
          {/* Hero Banner with Promos */}
          <ShopHero />

          {/* Featured Categories */}
          <FeaturedCategories categories={categories} />

          {/* Sale Products Carousel */}
          {saleProducts.length > 0 && (
            <FeaturedProducts
              products={saleProducts}
              title="On Sale Now"
              subtitle="Limited time deals you don't want to miss"
              viewAllHref="/shop?onSale=true"
              viewAllText="View All Deals"
            />
          )}

          {/* Section Divider */}
          <div className="border-t border-border my-8" />
        </>
      )}

      {/* Page Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {searchQuery
              ? `Search results for "${searchQuery}"`
              : hasFilters
                ? 'Filtered Results'
                : 'All Products'}
          </h1>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        <p className="text-muted-foreground">
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
          searchQuery={searchQuery}
          initialTotal={initialTotal}
        />
      </Suspense>
    </div>
  );
}

function ShopLoadingSkeleton() {
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Filter Skeleton */}
      <aside className="hidden lg:block w-64 flex-shrink-0">
        <div className="space-y-4">
          <div className="h-6 bg-muted rounded w-24 animate-pulse" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </div>
      </aside>

      {/* Products Skeleton */}
      <div className="flex-1">
        <div className="flex justify-between mb-6">
          <div className="h-10 bg-muted rounded w-32 animate-pulse" />
          <div className="h-10 bg-muted rounded w-40 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="aspect-square bg-muted animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
                <div className="h-6 bg-muted rounded w-1/4 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
