import { Suspense } from 'react';
import { Metadata } from 'next';
import { getAllProducts, getProductCategories } from '@/lib/products/combined-service';
import ShopPageClient from '@/components/shop/ShopPageClient';

export const metadata: Metadata = {
  title: 'Shop | Maleq',
  description: 'Browse our collection of quality products. Filter by category, price, and more.',
};

export const dynamic = 'force-dynamic'; // Use dynamic rendering

export default async function ShopPage() {
  // Get products and categories from WooCommerce
  const [{ products, pageInfo }, categories] = await Promise.all([
    getAllProducts({ limit: 24 }),
    getProductCategories(),
  ]);

  // Format categories for filter panel
  const formattedCategories = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    count: cat.count,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Shop</h1>
        <p className="text-muted-foreground">
          Browse our collection of quality products
        </p>
      </div>

      {/* Shop Content with Filters */}
      <Suspense fallback={<ShopLoadingSkeleton />}>
        <ShopPageClient
          initialProducts={products}
          categories={formattedCategories}
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
