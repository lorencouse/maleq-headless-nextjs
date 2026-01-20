import { Suspense } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductsByCategory, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import { findCategoryBySlug, flattenCategories } from '@/lib/utils/category-helpers';
import ShopPageClient from '@/components/shop/ShopPageClient';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

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
      title: 'Category Not Found | Maleq',
    };
  }

  return {
    title: `${category.name} | Shop | Maleq`,
    description: `Browse our ${category.name} collection at Maleq.`,
  };
}

export async function generateStaticParams() {
  const categories = await getHierarchicalCategories();
  const allCategories = flattenCategories(categories);
  return allCategories.map((category) => ({
    slug: category.slug,
  }));
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

  // Get products - use filtered query if additional filters, otherwise simple category query
  const products = hasAdditionalFilters
    ? (await getFilteredProducts({
        limit: 24,
        category: slug,
        brand,
        color,
        material,
        minPrice,
        maxPrice,
        inStock,
        onSale,
      })).products
    : await getProductsByCategory(slug, 24);

  // Build breadcrumb items
  const breadcrumbItems = [
    { label: 'Shop', href: '/shop' },
    { label: category.name },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Breadcrumbs */}
      <Breadcrumbs items={breadcrumbItems} />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">{category.name}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {products.length} {products.length === 1 ? 'product' : 'products'}
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
            className="w-16 h-16 mx-auto mb-4 text-muted"
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
            This category doesn&apos;t have any products yet.
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {[...Array(8)].map((_, i) => (
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
  );
}
