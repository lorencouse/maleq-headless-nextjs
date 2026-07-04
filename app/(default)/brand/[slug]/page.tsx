import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  getBrandBySlug,
  getBrands,
  getHierarchicalCategories,
  getGlobalAttributes,
  getFilteredProducts,
} from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import ShopPageClient from '@/components/shop/ShopPageClient';
import BrandHero from '@/components/shop/BrandHero';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';
import { stripHtml } from '@/lib/utils/text-utils';
import { BreadcrumbSchema, BrandSchema } from '@/components/seo/StructuredData';

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'brands' });
  try {
    const { slug } = await params;
    const brand = await getBrandBySlug(slug);

    if (!brand) {
      return {
        title: t('brandNotFound'),
      };
    }

    const description = brand.description
      ? stripHtml(brand.description).slice(0, 160)
      : t('brandMetaDescriptionFallback', { name: brand.name, count: brand.count ?? 0 });

    return {
      title: t('brandMetaTitle', { name: brand.name }),
      description,
      openGraph: {
        title: t('brandMetaOgTitle', { name: brand.name }),
        description,
        type: 'website',
      },
      twitter: {
        card: 'summary',
        title: t('brandMetaOgTitle', { name: brand.name }),
        description,
      },
      alternates: {
        canonical: `/brand/${slug}`,
      },
    };
  } catch (error) {
    console.error('generateMetadata error for brand:', error);
    return { title: t('metaTitle') };
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Dynamic page: uses searchParams for filtering (color, material, price, etc.)
// Data fetching uses unstable_cache and in-memory product index, so no perf penalty.
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
// No generateStaticParams: with force-dynamic nothing is prerendered, so
// enumerating all brands at build time was pure wasted work on the build host.

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { slug } = await params;
  const urlParams = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'brands' });

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
  const [productsResult, saleProductsResult] = await Promise.all([
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
        })
      : getFilteredProducts({ limit: 24, brand: slug }),
    // Only fetch sale products if no filters are active
    !hasAdditionalFilters
      ? getFilteredProducts({
          limit: 8,
          brand: slug,
          onSale: true,
          inStock: true,
        })
      : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } }),
  ]);

  const products = sortProductsByPriority(productsResult.products);
  const productsPageInfo = productsResult.pageInfo;
  const saleProducts = saleProductsResult.products;
  const displayedProductCount = hasAdditionalFilters
    ? products.length
    : (brand.count ?? products.length);

  // Show featured sections only when no filters are active
  const showFeaturedSections = !hasAdditionalFilters;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Breadcrumb Schema */}
      <BreadcrumbSchema
        items={[
          { name: 'Home', url: SITE_URL },
          { name: 'Brands', url: `${SITE_URL}/brands` },
          { name: brand.name, url: `${SITE_URL}/brand/${slug}` },
        ]}
      />

      {/* Brand entity schema — sameAs links the manufacturer's official site
          so search engines can disambiguate the brand (Knowledge Graph). */}
      <BrandSchema
        name={brand.name}
        url={`${SITE_URL}/brand/${slug}`}
        sameAs={brand.website ? [brand.website] : undefined}
        description={brand.description ? stripHtml(brand.description).slice(0, 300) : undefined}
      />

      {/* Brand Hero */}
      <BrandHero
        brand={brand}
        productCount={displayedProductCount}
      />

      {/* Featured Sections - Only show when no filters */}
      {showFeaturedSections && (
        <>
          {/* Sale Products for this Brand */}
          {saleProducts.length > 0 && (
            <FeaturedProducts
              products={saleProducts}
              title={t('onSaleTitle', { name: brand.name })}
              subtitle={t('onSaleSubtitle')}
              viewAllHref={`/brand/${slug}?onSale=true`}
              viewAllText={t('viewAllDeals')}
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
            {hasAdditionalFilters ? t('filteredResults') : t('allBrandProducts', { name: brand.name })}
          </h2>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        <p className="text-sm text-muted-foreground">
          {hasAdditionalFilters
            ? t('productCountFiltered', { count: displayedProductCount })
            : t('productCountAvailable', { count: displayedProductCount })}
        </p>
      </div>

      {/* Products */}
      <Suspense fallback={<BrandLoadingSkeleton />}>
        <ShopPageClient
          initialProducts={products}
          categories={allCategories}
          brands={brandsData}
          colors={colorsData}
          materials={materialsData}
          hasMore={productsPageInfo.hasNextPage}
          initialCursor={productsPageInfo.endCursor}
          initialBrand={slug}
          initialTotal={displayedProductCount}
        />
      </Suspense>
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
