import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import { findCategoryBySlug, findParentCategory } from '@/lib/utils/category-helpers';
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

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  try {
    const { slug } = await params;
    const categories = await getHierarchicalCategories();
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

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;

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
  const [productsResult, saleProductsResult] = await Promise.all([
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
        })
      : getAllProducts({ category: slug, limit: 24 }),
    // Only fetch sale products if no filters are active
    !hasAdditionalFilters
      ? getFilteredProducts({
          limit: 8,
          category: slug,
          onSale: true,
          inStock: true,
        })
      : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, endCursor: null } }),
  ]);

  const products = sortProductsByPriority(productsResult.products);
  const productsPageInfo = productsResult.pageInfo;
  const saleProducts = saleProductsResult.products;

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
          {products.length} {products.length === 1 ? 'product' : 'products'}
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
