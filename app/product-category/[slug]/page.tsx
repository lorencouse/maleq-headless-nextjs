import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductsByCategory, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import { findCategoryBySlug, flattenCategories, findParentCategory } from '@/lib/utils/category-helpers';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import ShopPageClient from '@/components/shop/ShopPageClient';
import CategoryHero from '@/components/shop/CategoryHero';
import SubcategoryGrid from '@/components/shop/SubcategoryGrid';
import FeaturedProducts from '@/components/shop/FeaturedProducts';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await getHierarchicalCategories();
  const category = findCategoryBySlug(categories, slug);

  if (!category) {
    return {
      title: 'Category Not Found | Male Q',
    };
  }

  return {
    title: `${category.name} | Shop | Male Q`,
    description: `Browse our ${category.name} collection at Male Q. ${category.count} products available with fast, discreet shipping.`,
    openGraph: {
      title: `${category.name} | Male Q`,
      description: `Shop ${category.name} at Male Q. Fast, discreet shipping available.`,
      type: 'website',
    },
  };
}

export async function generateStaticParams() {
  const categories = await getHierarchicalCategories();
  const allCategories = flattenCategories(categories);
  const params = allCategories.map((category) => ({
    slug: category.slug,
  }));
  return limitStaticParams(params, DEV_LIMITS.categories);
}

export const dynamic = 'force-dynamic'; // Use dynamic rendering

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

  // Get hierarchical categories, brands, and attributes
  const [allCategories, brandsData, { colors: colorsData, materials: materialsData }] = await Promise.all([
    getHierarchicalCategories(),
    getBrands(),
    getGlobalAttributes(),
  ]);

  const category = findCategoryBySlug(allCategories, slug);

  if (!category) {
    notFound();
  }

  // Find parent category for breadcrumbs
  const parentCategory = findParentCategory(allCategories, slug);

  // Fetch products and sale products in parallel
  const [products, saleProductsResult] = await Promise.all([
    hasAdditionalFilters
      ? getFilteredProducts({
          limit: 24,
          category: slug,
          brand,
          color,
          material,
          minPrice,
          maxPrice,
          inStock,
          onSale,
        }).then(r => r.products)
      : getProductsByCategory(slug, 24),
    // Only fetch sale products if no filters are active
    !hasAdditionalFilters
      ? getFilteredProducts({
          limit: 8,
          category: slug,
          onSale: true,
        })
      : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } }),
  ]);

  const saleProducts = saleProductsResult.products;

  // Get child categories with products
  const childCategories = category.children?.filter(c => c.count > 0) || [];

  // Show featured sections only when no filters are active
  const showFeaturedSections = !hasAdditionalFilters;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Category Hero */}
      <CategoryHero
        category={category}
        productCount={products.length}
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
              />
            </div>
          )}

          {/* Sale Products for this Category */}
          {saleProducts.length > 0 && (
            <FeaturedProducts
              products={saleProducts}
              title={`${category.name} on Sale`}
              subtitle="Limited time deals in this category"
              viewAllHref={`/product-category/${slug}?onSale=true`}
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
        <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1">
          {hasAdditionalFilters ? 'Filtered Results' : `All ${category.name}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? 'product' : 'products'}
          {hasAdditionalFilters ? ' matching your filters' : ' available'}
        </p>
      </div>

      {/* Products */}
      {products.length > 0 ? (
        <Suspense fallback={<CategoryLoadingSkeleton />}>
          <ShopPageClient
            initialProducts={products}
            categories={allCategories}
            brands={brandsData}
            colors={colorsData}
            materials={materialsData}
            hasMore={false}
            initialCategory={slug}
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
              : 'This category doesn\'t have any products yet.'}
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
