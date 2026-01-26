import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getBrandBySlug,
  getProductsByBrand,
  getBrands,
  getHierarchicalCategories,
  getGlobalAttributes,
  getFilteredProducts,
} from '@/lib/products/combined-service';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import ShopPageClient from '@/components/shop/ShopPageClient';
import BrandHero from '@/components/shop/BrandHero';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);

  if (!brand) {
    return {
      title: 'Brand Not Found | Male Q',
    };
  }

  const description = brand.description
    ? brand.description.replace(/<[^>]*>/g, '').slice(0, 160)
    : `Shop ${brand.name} products at Male Q. ${brand.count} products available with fast, discreet shipping.`;

  return {
    title: `${brand.name} | Shop by Brand | Male Q`,
    description,
    openGraph: {
      title: `${brand.name} | Male Q`,
      description,
      type: 'website',
    },
  };
}

export async function generateStaticParams() {
  const brands = await getBrands();
  const params = brands.map((brand) => ({
    slug: brand.slug,
  }));
  return limitStaticParams(params, DEV_LIMITS.brands);
}

// ISR: Revalidate every 24 hours for fresh product/stock data
export const revalidate = 86400;
export const dynamicParams = true; // Allow runtime generation

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { slug } = await params;
  const urlParams = await searchParams;

  // Parse additional filter params from URL
  const category = typeof urlParams.category === 'string' ? urlParams.category : undefined;
  const color = typeof urlParams.color === 'string' ? urlParams.color : undefined;
  const material = typeof urlParams.material === 'string' ? urlParams.material : undefined;
  const minPrice = typeof urlParams.minPrice === 'string' ? parseFloat(urlParams.minPrice) : undefined;
  const maxPrice = typeof urlParams.maxPrice === 'string' ? parseFloat(urlParams.maxPrice) : undefined;
  const inStock = urlParams.inStock === 'true';
  const onSale = urlParams.onSale === 'true';

  // Check if any additional filters are active (beyond the brand)
  const hasAdditionalFilters = category || color || material ||
    (minPrice !== undefined && minPrice > 0) ||
    (maxPrice !== undefined && maxPrice < 500) ||
    inStock || onSale;

  // Get brand, categories, brands list, and attributes
  const [brand, allCategories, brandsData, { colors: colorsData, materials: materialsData }] = await Promise.all([
    getBrandBySlug(slug),
    getHierarchicalCategories(),
    getBrands(),
    getGlobalAttributes(),
  ]);

  if (!brand) {
    notFound();
  }

  // Fetch products and sale products in parallel
  const [products, saleProductsResult] = await Promise.all([
    hasAdditionalFilters
      ? getFilteredProducts({
          limit: 24,
          brand: slug,
          category,
          color,
          material,
          minPrice,
          maxPrice,
          inStock,
          onSale,
        }).then(r => r.products)
      : getProductsByBrand(slug, 24),
    // Only fetch sale products if no filters are active
    !hasAdditionalFilters
      ? getFilteredProducts({
          limit: 8,
          brand: slug,
          onSale: true,
        })
      : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } }),
  ]);

  const saleProducts = saleProductsResult.products;

  // Show featured sections only when no filters are active
  const showFeaturedSections = !hasAdditionalFilters;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Brand Hero */}
      <BrandHero
        brand={brand}
        productCount={products.length}
      />

      {/* Featured Sections - Only show when no filters */}
      {showFeaturedSections && (
        <>
          {/* Sale Products for this Brand */}
          {saleProducts.length > 0 && (
            <FeaturedProducts
              products={saleProducts}
              title={`${brand.name} on Sale`}
              subtitle="Limited time deals from this brand"
              viewAllHref={`/brand/${slug}?onSale=true`}
              viewAllText="View All Deals"
            />
          )}

          {/* Section Divider */}
          {saleProducts.length > 0 && (
            <div className="border-t border-border my-8" />
          )}
        </>
      )}

      {/* All Products Header */}
      <div id="products" className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-1">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            {hasAdditionalFilters ? 'Filtered Results' : `All ${brand.name} Products`}
          </h2>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        <p className="text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? 'product' : 'products'}
          {hasAdditionalFilters ? ' matching your filters' : ' available'}
        </p>
      </div>

      {/* Products */}
      {products.length > 0 ? (
        <Suspense fallback={<BrandLoadingSkeleton />}>
          <ShopPageClient
            initialProducts={products}
            categories={allCategories}
            brands={brandsData}
            colors={colorsData}
            materials={materialsData}
            hasMore={false}
            initialBrand={slug}
          />
        </Suspense>
      ) : (
        <div className="text-center py-16">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">No products found</h2>
          <p className="text-muted-foreground mb-6">
            {hasAdditionalFilters
              ? 'Try adjusting your filters to find what you\'re looking for.'
              : 'This brand doesn\'t have any products yet.'}
          </p>
          <a
            href="/shop"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
          >
            Browse All Products
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}

function BrandLoadingSkeleton() {
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
