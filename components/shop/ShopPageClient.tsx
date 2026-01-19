'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import ProductCard from './ProductCard';
import FilterPanel, { FilterState } from './filters/FilterPanel';
import ActiveFilters from './filters/ActiveFilters';
import SortDropdown, { SortOption } from './SortDropdown';
import { UnifiedProduct } from '@/lib/products/combined-service';

interface ShopPageClientProps {
  initialProducts: UnifiedProduct[];
  categories: { id: string; name: string; slug: string; count?: number }[];
  hasMore: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  category: '',
  minPrice: 0,
  maxPrice: 500,
  inStock: false,
  onSale: false,
};

export default function ShopPageClient({
  initialProducts,
  categories,
  hasMore: initialHasMore,
}: ShopPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState(initialProducts);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  // Parse filters from URL
  const filters: FilterState = useMemo(() => ({
    category: searchParams.get('category') || '',
    minPrice: parseInt(searchParams.get('minPrice') || '0', 10),
    maxPrice: parseInt(searchParams.get('maxPrice') || '500', 10),
    inStock: searchParams.get('inStock') === 'true',
    onSale: searchParams.get('onSale') === 'true',
  }), [searchParams]);

  const sortBy: SortOption = (searchParams.get('sort') as SortOption) || 'newest';

  // Update URL with filters
  const updateURL = useCallback((newFilters: FilterState, newSort: SortOption) => {
    const params = new URLSearchParams();

    if (newFilters.category) params.set('category', newFilters.category);
    if (newFilters.minPrice > 0) params.set('minPrice', newFilters.minPrice.toString());
    if (newFilters.maxPrice < 500) params.set('maxPrice', newFilters.maxPrice.toString());
    if (newFilters.inStock) params.set('inStock', 'true');
    if (newFilters.onSale) params.set('onSale', 'true');
    if (newSort !== 'newest') params.set('sort', newSort);

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router]);

  // Filter and sort products client-side
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Apply filters
    if (filters.category) {
      result = result.filter((p) =>
        p.categories.some((c) => c.slug === filters.category)
      );
    }

    if (filters.minPrice > 0 || filters.maxPrice < 500) {
      result = result.filter((p) => {
        const price = parseFloat(p.price?.replace(/[^0-9.]/g, '') || '0');
        return price >= filters.minPrice && price <= filters.maxPrice;
      });
    }

    if (filters.inStock) {
      result = result.filter((p) => p.stockStatus === 'IN_STOCK');
    }

    if (filters.onSale) {
      result = result.filter((p) => p.onSale);
    }

    // Apply sorting
    switch (sortBy) {
      case 'price-asc':
        result.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceA - priceB;
        });
        break;
      case 'price-desc':
        result.sort((a, b) => {
          const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '0');
          const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '0');
          return priceB - priceA;
        });
        break;
      case 'name-asc':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        result.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'popularity':
        result.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
        break;
      // 'newest' is default, keep original order
    }

    return result;
  }, [products, filters, sortBy]);

  // Handle filter changes
  const handleFilterChange = (newFilters: FilterState) => {
    updateURL(newFilters, sortBy);
  };

  // Handle sort change
  const handleSortChange = (newSort: SortOption) => {
    updateURL(filters, newSort);
  };

  // Clear all filters
  const handleClearFilters = () => {
    updateURL(DEFAULT_FILTERS, sortBy);
  };

  // Remove single filter
  const handleRemoveFilter = (key: keyof FilterState) => {
    const newFilters = { ...filters };
    if (key === 'minPrice' || key === 'maxPrice') {
      newFilters.minPrice = 0;
      newFilters.maxPrice = 500;
    } else if (key === 'category') {
      newFilters.category = '';
    } else if (key === 'inStock') {
      newFilters.inStock = false;
    } else if (key === 'onSale') {
      newFilters.onSale = false;
    }
    updateURL(newFilters, sortBy);
  };

  // Load more products
  const handleLoadMore = async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('after', cursor);
      params.set('limit', '12');

      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();

      if (data.products) {
        setProducts((prev) => [...prev, ...data.products]);
        setHasMore(data.pageInfo?.hasNextPage || false);
        setCursor(data.pageInfo?.endCursor || null);
      }
    } catch (error) {
      console.error('Error loading more products:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Close mobile filter on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileFilterOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Prevent body scroll when mobile filter is open
  useEffect(() => {
    if (isMobileFilterOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileFilterOpen]);

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Desktop Filter Sidebar */}
      <aside className="hidden lg:block w-64 flex-shrink-0">
        <div className="sticky top-24">
          <h2 className="text-lg font-semibold text-foreground mb-4">Filters</h2>
          <FilterPanel
            categories={categories}
            filters={filters}
            onFilterChange={handleFilterChange}
            onClearFilters={handleClearFilters}
          />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            {/* Mobile Filter Button */}
            <button
              onClick={() => setIsMobileFilterOpen(true)}
              className="lg:hidden flex items-center gap-2 px-4 py-2 border border-input rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-sm font-medium">Filters</span>
            </button>

            {/* Results Count */}
            <p className="text-sm text-muted-foreground">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
            </p>
          </div>

          {/* Sort Dropdown */}
          <SortDropdown value={sortBy} onChange={handleSortChange} />
        </div>

        {/* Active Filters */}
        <ActiveFilters
          filters={filters}
          categories={categories}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={handleClearFilters}
        />

        {/* Products Grid */}
        {filteredProducts.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className="px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading...
                    </span>
                  ) : (
                    'Load More Products'
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground mb-2">No products found</h3>
            <p className="text-muted-foreground mb-6">
              Try adjusting your filters to find what you&apos;re looking for.
            </p>
            <button
              onClick={handleClearFilters}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Mobile Filter Overlay */}
      {isMobileFilterOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsMobileFilterOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-full max-w-sm bg-background z-50 lg:hidden overflow-y-auto">
            <FilterPanel
              categories={categories}
              filters={filters}
              onFilterChange={handleFilterChange}
              onClearFilters={handleClearFilters}
              isMobile
              onClose={() => setIsMobileFilterOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
