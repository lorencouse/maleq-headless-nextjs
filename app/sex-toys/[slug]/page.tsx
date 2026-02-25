import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts, type FilterOption } from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import { findCategoryBySlug, findParentCategory } from '@/lib/utils/category-helpers';
import { isMySQLConfigured, isMySQLReachable } from '@/lib/db/pool';
import { queryProductIndex, type FacetOption } from '@/lib/products/product-index';
import { indexEntriesToUnifiedProducts } from '@/lib/products/index-to-unified';
import { loadHierarchicalCategories } from '@/lib/db/category-loader';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import ShopPageClient from '@/components/shop/ShopPageClient';
import CategoryHero from '@/components/shop/CategoryHero';
import SubcategoryGrid from '@/components/shop/SubcategoryGrid';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';
import { BreadcrumbSchema } from '@/components/seo/StructuredData';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Try MySQL categories first, fall back to GraphQL */
async function getCategories() {
  if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
    try {
      return await loadHierarchicalCategories();
    } catch (err) {
      console.error('[category] MySQL categories failed, falling back to GraphQL:', err);
    }
  }
  return getHierarchicalCategories();
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  try {
    const { slug } = await params;
    const categories = await getCategories();
    const category = findCategoryBySlug(categories, slug);

    if (!category) {
      return {
        title: 'Category Not Found',
      };
    }

    const description = `Browse our ${category.name} collection at Male Q. ${category.count} products available with fast, discreet shipping.`;

    return {
      title: `${category.name} | Shop`,
      description,
      openGraph: {
        title: `${category.name} | Male Q`,
        description,
        type: 'website',
      },
      twitter: {
        card: 'summary',
        title: `${category.name} | Male Q`,
        description,
      },
      alternates: {
        canonical: `/sex-toys/${slug}`,
      },
    };
  } catch (error) {
    console.error('generateMetadata error:', error);
    return { title: 'Shop' };
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Dynamic page: uses searchParams for filtering (brand, color, material, price, etc.)
// Data fetching uses unstable_cache and in-memory product index, so no perf penalty.
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    if (await isMySQLReachable()) {
      const categories = await loadHierarchicalCategories();
      // Flatten hierarchical categories to get all slugs
      const params: { slug: string }[] = [];
      function collectSlugs(cats: typeof categories) {
        for (const cat of cats) {
          params.push({ slug: cat.slug });
          if (cat.children) collectSlugs(cat.children);
        }
      }
      collectSlugs(categories);
      return limitStaticParams(params, DEV_LIMITS.categories);
    }
  } catch {}

  // GraphQL fallback
  try {
    const categories = await getHierarchicalCategories();
    const params: { slug: string }[] = [];
    function collectSlugs(cats: typeof categories) {
      for (const cat of cats) {
        params.push({ slug: cat.slug });
        if (cat.children) collectSlugs(cat.children);
      }
    }
    collectSlugs(categories);
    return limitStaticParams(params, DEV_LIMITS.categories);
  } catch (error) {
    console.error('Error generating static params for categories:', error);
    return [];
  }
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const urlParams = await searchParams;

  // Parse additional filter params from URL
  const brand = typeof urlParams.brand === 'string' ? urlParams.brand : undefined;
  const color = typeof urlParams.color === 'string' ? urlParams.color : undefined;
  const material = typeof urlParams.material === 'string' ? urlParams.material : undefined;
  const minPrice = typeof urlParams.minPrice === 'string' ? parseFloat(urlParams.minPrice) : undefined;
  const maxPrice = typeof urlParams.maxPrice === 'string' ? parseFloat(urlParams.maxPrice) : undefined;
  const inStock = urlParams.inStock === 'true';
  const onSale = urlParams.onSale === 'true';

  // Check if any additional filters are active (beyond the category)
  const hasAdditionalFilters = brand || color || material ||
    (minPrice !== undefined && minPrice > 0) ||
    (maxPrice !== undefined && maxPrice < 500) ||
    inStock || onSale;

  const useIndex = isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql';

  // Get hierarchical categories (MySQL or GraphQL)
  const allCategories = await getCategories();

  const category = findCategoryBySlug(allCategories, slug);

  if (!category) {
    notFound();
  }

  // Find parent category for breadcrumbs
  const parentCategory = findParentCategory(allCategories, slug);

  // ─── Fetch products + filters ───
  let products: Awaited<ReturnType<typeof getAllProducts>>['products'] = [];
  let productsPageInfo = { hasNextPage: false, endCursor: null as string | null };
  let saleProducts: typeof products = [];
  let brandsData: FilterOption[] = [];
  let colorsData: FilterOption[] = [];
  let materialsData: FilterOption[] = [];
  let totalProductCount = 0;

  if (useIndex) {
    try {
      const facetToFilterOption = (f: FacetOption): FilterOption => ({ id: f.slug, name: f.name, slug: f.slug, count: f.count });

      // Main products + sale products in parallel
      const [mainResult, saleResult] = await Promise.all([
        queryProductIndex({
          category: slug,
          brand,
          color,
          material,
          minPrice,
          maxPrice,
          inStock,
          onSale,
          sort: 'popularity',
          limit: 24,
          offset: 0,
        }),
        !hasAdditionalFilters
          ? queryProductIndex({ category: slug, onSale: true, inStock: true, limit: 8, sort: 'popularity' })
          : Promise.resolve({ products: [], total: 0, facets: { brands: [], materials: [], colors: [], categories: [] } }),
      ]);

      products = indexEntriesToUnifiedProducts(mainResult.products);
      productsPageInfo = { hasNextPage: mainResult.total > 24, endCursor: null };
      totalProductCount = mainResult.total;
      saleProducts = indexEntriesToUnifiedProducts(saleResult.products);

      // Use facets from main result
      brandsData = mainResult.facets.brands.map(facetToFilterOption);
      colorsData = mainResult.facets.colors.map(facetToFilterOption);
      materialsData = mainResult.facets.materials.map(facetToFilterOption);
    } catch (err) {
      console.error('[category] Index query failed, falling back to GraphQL:', err);
      // Reset to trigger GraphQL fallback
      products = [];
    }
  }

  // GraphQL fallback
  if (!useIndex || products.length === 0) {
    try {
      const [brandsResult, attrsResult, productsResult, saleProductsResult] = await Promise.all([
        getBrands(),
        getGlobalAttributes(),
        hasAdditionalFilters
          ? getFilteredProducts({ limit: 24, category: slug, brand, color, material, minPrice, maxPrice, inStock, onSale })
          : getAllProducts({ category: slug, limit: 24 }),
        !hasAdditionalFilters
          ? getFilteredProducts({ limit: 8, category: slug, onSale: true, inStock: true })
          : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      ]);

      brandsData = brandsResult;
      colorsData = attrsResult.colors;
      materialsData = attrsResult.materials;
      products = productsResult.products;
      productsPageInfo = productsResult.pageInfo;
      totalProductCount = hasAdditionalFilters ? products.length : category.count;
      saleProducts = saleProductsResult.products;
    } catch (err) {
      console.error('[category] GraphQL fallback also failed:', err);
    }
  }

  products = sortProductsByPriority(products);
  const displayedProductCount = hasAdditionalFilters
    ? totalProductCount || products.length
    : category.count;

  // Get child categories with products
  const childCategories = category.children?.filter(c => c.count > 0) || [];

  // Show featured sections only when no filters are active
  const showFeaturedSections = !hasAdditionalFilters;

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Breadcrumb Schema */}
      <BreadcrumbSchema
        items={[
          { name: 'Home', url: SITE_URL },
          { name: 'Sex Toys', url: `${SITE_URL}/sex-toys` },
          ...(parentCategory
            ? [{ name: parentCategory.name, url: `${SITE_URL}/sex-toys/${parentCategory.slug}` }]
            : []),
          { name: category.name, url: `${SITE_URL}/sex-toys/${slug}` },
        ]}
      />

      {/* Category Hero */}
      <CategoryHero
        category={category}
        productCount={displayedProductCount}
        parentCategory={parentCategory}
      />

      {/* Featured Sections - Only show when no filters */}
      {showFeaturedSections && (
        <>
          {/* Child Categories */}
          {childCategories.length > 0 && (
            <div id="subcategories">
              <SubcategoryGrid
                subcategories={childCategories}
                parentSlug={slug}
                parentName={category.name}
              />
            </div>
          )}

          {/* Sale Products for this Category */}
          {saleProducts.length > 0 && (
            <FeaturedProducts
              products={saleProducts}
              title={`${category.name} on Sale`}
              subtitle="Limited time deals in this category"
              viewAllHref={`/sex-toys/${slug}?onSale=true`}
              viewAllText="View All Deals"
            />
          )}

          {/* Section Divider */}
          {(childCategories.length > 0 || saleProducts.length > 0) && (
            <div className="border-t border-border my-8" />
          )}
        </>
      )}

      {/* All Products Header */}
      <div id="products" className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-1">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            {hasAdditionalFilters ? 'Filtered Results' : `All ${category.name}`}
          </h2>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        <p className="text-sm text-muted-foreground">
          {displayedProductCount} {displayedProductCount === 1 ? 'product' : 'products'}
          {hasAdditionalFilters ? ' matching your filters' : ' available'}
        </p>
      </div>

      {/* Products */}
      <Suspense fallback={<CategoryLoadingSkeleton />}>
        <ShopPageClient
          initialProducts={products}
          categories={allCategories}
          brands={brandsData}
          colors={colorsData}
          materials={materialsData}
          hasMore={productsPageInfo.hasNextPage}
          initialCursor={productsPageInfo.endCursor}
          initialCategory={slug}
          initialTotal={displayedProductCount}
        />
      </Suspense>
    </div>
  );
}

function CategoryLoadingSkeleton() {
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
