import { Suspense } from 'react';
import { Metadata } from 'next';
import {
  searchProducts,
  getHierarchicalCategories,
} from '@/lib/products/combined-service';
import ShopPageClient from '@/components/shop/ShopPageClient';
import ShopSearch from '@/components/shop/ShopSearch';

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q || '';

  return {
    title: query ? `Search results for "${query}" | Male Q` : 'Search | Male Q',
    description: query
      ? `Browse search results for "${query}" in our collection of quality products.`
      : 'Search our collection of quality products.',
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.q || '';

  // Get products and categories
  // For search, filter options come from the search results
  const [searchResult, categories] = await Promise.all([
    query ? searchProducts(query, { limit: 24, offset: 0 }) : Promise.resolve({ products: [], pageInfo: { hasNextPage: false, total: 0 }, availableFilters: undefined }),
    getHierarchicalCategories(),
  ]);

  const products = searchResult.products;
  const hasMore = searchResult.pageInfo.hasNextPage;
  const totalResults = searchResult.pageInfo.total;

  // Use filter options from search results (only shows filters relevant to the search)
  const availableFilters = searchResult.availableFilters;
  const brands = availableFilters?.brands ?? [];
  const colors = availableFilters?.colors ?? [];
  const materials = availableFilters?.materials ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <h1 className="text-3xl font-bold text-foreground">
            {query ? `Search results for "${query}"` : 'Search'}
          </h1>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        {!query && (
          <p className="text-muted-foreground">
            Enter a search term to find products
          </p>
        )}
      </div>

      {/* Search Results */}
      {query ? (
        products.length > 0 ? (
          <Suspense fallback={<SearchLoadingSkeleton />}>
            <ShopPageClient
              initialProducts={products}
              categories={categories}
              brands={brands}
              colors={colors}
              materials={materials}
              hasMore={hasMore}
              searchQuery={query}
              initialTotal={totalResults}
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
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              We couldn&apos;t find any products matching &quot;{query}&quot;. Try using different
              keywords or browse our categories.
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
        )
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">Start your search</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Use the search bar above to find products in our collection.
          </p>
        </div>
      )}
    </div>
  );
}

function SearchLoadingSkeleton() {
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
