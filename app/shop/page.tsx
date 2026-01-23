import { Suspense } from 'react';
import { Metadata } from 'next';
import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import ShopPageClient from '@/components/shop/ShopPageClient';
import ShopHero from '@/components/shop/ShopHero';
import FeaturedCategories from '@/components/shop/FeaturedCategories';
import FeaturedProducts from '@/components/shop/FeaturedProducts';

export const metadata: Metadata = {
  title: 'Shop | Male Q',
  description: 'Browse our collection of quality products. Filter by category, price, and more.',
};

export const dynamic = 'force-dynamic'; // Use dynamic rendering

interface ShopPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;

  // Parse filter params from URL
  const category = typeof params.category === 'string' ? params.category : undefined;
  const brand = typeof params.brand === 'string' ? params.brand : undefined;
  const color = typeof params.color === 'string' ? params.color : undefined;
  const material = typeof params.material === 'string' ? params.material : undefined;
  const minPrice = typeof params.minPrice === 'string' ? parseFloat(params.minPrice) : undefined;
  const maxPrice = typeof params.maxPrice === 'string' ? parseFloat(params.maxPrice) : undefined;
  const inStock = params.inStock === 'true';
  const onSale = params.onSale === 'true';

  // Check if any filters are active
  const hasFilters = category || brand || color || material ||
    (minPrice !== undefined && minPrice > 0) ||
    (maxPrice !== undefined && maxPrice < 500) ||
    inStock || onSale;

  // Fetch products - use filtered query if filters are present
  const productsPromise = hasFilters
    ? getFilteredProducts({
        limit: 24,
        category,
        brand,
        color,
        material,
        minPrice,
        maxPrice,
        inStock,
        onSale,
      })
    : getAllProducts({ limit: 24 });

  // Also fetch sale products for featured section (only when no filters active)
  const saleProductsPromise = !hasFilters
    ? getFilteredProducts({ limit: 8, onSale: true })
    : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } });

  // Get products, categories, brands, and attributes from WooCommerce
  const [{ products, pageInfo }, { products: saleProducts }, categories, brands, { colors, materials }] = await Promise.all([
    productsPromise,
    saleProductsPromise,
    getHierarchicalCategories(),
    getBrands(),
    getGlobalAttributes(),
  ]);

  // Show featured sections only when no filters are active
  const showFeaturedSections = !hasFilters;

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
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
          {hasFilters ? 'Filtered Results' : 'All Products'}
        </h1>
        <p className="text-muted-foreground">
          {hasFilters
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
