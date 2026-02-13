'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import ProductCard from './ProductCard';
import FilterPanel, { FilterState } from './filters/FilterPanel';
import ActiveFilters from './filters/ActiveFilters';
import SortDropdown, { SortOption } from './SortDropdown';
import { UnifiedProduct, HierarchicalCategory, FilterOption } from '@/lib/products/combined-service';
import { extractFilterOptionsFromProducts } from '@/lib/utils/product-filter-helpers';

// Module-level cache to preserve product state across navigations
let productCache: {
  key: string;
  products: UnifiedProduct[];
  totalCount: number;
  hasMore: boolean;
  cursor: string | null;
  searchOffset: number;
  brands: FilterOption[];
  materials: FilterOption[];
  colors: FilterOption[];
} | null = null;

function getCacheKey(pathname: string, params: URLSearchParams): string {
  const sorted = new URLSearchParams([...params.entries()].sort());
  return `${pathname}?${sorted.toString()}`;
}

interface ShopPageClientProps {
  initialProducts: UnifiedProduct[];
  categories: HierarchicalCategory[];
  brands?: FilterOption[];
  colors?: FilterOption[];
  materials?: FilterOption[];
  hasMore: boolean;
  initialCursor?: string | null;
  searchQuery?: string;
  initialCategory?: string;
  initialBrand?: string;
  initialTotal?: number;
}

const DEFAULT_FILTERS: FilterState = {
  category: '',
  brand: '',
  color: '',
  material: '',
  minPrice: 0,
  maxPrice: 0,
  minLength: 0,
  maxLength: 24,
  minWeight: 0,
  maxWeight: 10,
  inStock: false,
  onSale: false,
  productType: '',
};

export default function ShopPageClient({
  initialProducts,
  categories,
  brands = [],
  colors = [],
  materials = [],
  hasMore: initialHasMore,
  initialCursor: initialCursorProp,
  searchQuery,
  initialCategory,
  initialBrand,
  initialTotal,
}: ShopPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Check for cached state matching current URL
  const cacheKey = getCacheKey(pathname, searchParams);
  const cached = productCache?.key === cacheKey ? productCache : null;

  const [products, setProducts] = useState(cached?.products ?? initialProducts);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? initialHasMore);
  const [totalCount, setTotalCount] = useState(cached?.totalCount ?? initialTotal ?? initialProducts.length);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? initialCursorProp ?? null);
  const [searchOffset, setSearchOffset] = useState(cached?.searchOffset ?? initialProducts.length);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [availableBrands, setAvailableBrands] = useState<FilterOption[]>(cached?.brands ?? brands);
  const [availableMaterials, setAvailableMaterials] = useState<FilterOption[]>(cached?.materials ?? materials);
  const [availableColors, setAvailableColors] = useState<FilterOption[]>(cached?.colors ?? colors);
  const isInitialMount = useRef(true);
  const restoredFromCache = useRef(!!cached);
  const hasInitialSearchResults = useRef(!!searchQuery && initialProducts.length > 0);
  const hasExtractedInitialFilters = useRef(!!cached || false);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const isLoadingMore = useRef(false);

  // Track if user entered page with filters/search (browse mode hides hero)
  const isInBrowseMode = useRef(
    !!searchQuery ||
    searchParams.has('category') ||
    searchParams.has('brand') ||
    searchParams.has('color') ||
    searchParams.has('material') ||
    searchParams.has('minPrice') ||
    searchParams.has('maxPrice') ||
    searchParams.has('inStock') ||
    searchParams.has('onSale') ||
    searchParams.has('productType') ||
    searchParams.has('browse')
  );

  // Track base filter options (from search/category context)
  // These are the full list of options before any brand/color/material filters are applied
  const baseFilterOptions = useRef<{
    search?: string;
    category?: string;
    brands: FilterOption[];
    materials: FilterOption[];
    colors: FilterOption[];
  }>({
    search: searchQuery,
    category: searchParams.get('category') || undefined,
    brands: brands,
    materials: materials,
    colors: colors,
  });

  // Extract filter options from initial products for search pages
  useEffect(() => {
    if (searchQuery && initialProducts.length > 0 && !hasExtractedInitialFilters.current) {
      hasExtractedInitialFilters.current = true;
      const extracted = extractFilterOptionsFromProducts(initialProducts);
      if (extracted.brands.length > 0) setAvailableBrands(extracted.brands);
      if (extracted.materials.length > 0) setAvailableMaterials(extracted.materials);
      if (extracted.colors.length > 0) setAvailableColors(extracted.colors);
    }
  }, [searchQuery, initialProducts]);

  // Parse filters from URL (use initialCategory/initialBrand as fallback for category/brand pages)
  const categoryFilter = searchParams.get('category') || initialCategory || '';
  const brandFilter = searchParams.get('brand') || initialBrand || '';
  const colorFilter = searchParams.get('color') || '';
  const materialFilter = searchParams.get('material') || '';
  const minPriceFilter = parseInt(searchParams.get('minPrice') || '0', 10);
  const maxPriceFilter = parseInt(searchParams.get('maxPrice') || '0', 10);
  const minLengthFilter = parseFloat(searchParams.get('minLength') || '0');
  const maxLengthFilter = parseFloat(searchParams.get('maxLength') || '24');
  const minWeightFilter = parseFloat(searchParams.get('minWeight') || '0');
  const maxWeightFilter = parseFloat(searchParams.get('maxWeight') || '10');
  const inStockFilter = searchParams.get('inStock') === 'true';
  const onSaleFilter = searchParams.get('onSale') === 'true';
  const productTypeFilter = searchParams.get('productType') || '';
  const sortBy: SortOption = (searchParams.get('sort') as SortOption) || 'newest';

  const filters: FilterState = {
    category: categoryFilter,
    brand: brandFilter,
    color: colorFilter,
    material: materialFilter,
    minPrice: minPriceFilter,
    maxPrice: maxPriceFilter,
    minLength: minLengthFilter,
    maxLength: maxLengthFilter,
    minWeight: minWeightFilter,
    maxWeight: maxWeightFilter,
    inStock: inStockFilter,
    onSale: onSaleFilter,
    productType: productTypeFilter,
  };

  // Update URL with filters
  const updateURL = useCallback((newFilters: FilterState, newSort: SortOption) => {
    // Mark that we're now in browse mode (user has interacted with filters)
    isInBrowseMode.current = true;

    const params = new URLSearchParams();

    // Preserve search query if present
    if (searchQuery) params.set('q', searchQuery);

    if (newFilters.category) params.set('category', newFilters.category);
    if (newFilters.brand) params.set('brand', newFilters.brand);
    if (newFilters.color) params.set('color', newFilters.color);
    if (newFilters.material) params.set('material', newFilters.material);
    if (newFilters.minPrice > 0) params.set('minPrice', newFilters.minPrice.toString());
    if (newFilters.maxPrice > 0) params.set('maxPrice', newFilters.maxPrice.toString());
    if (newFilters.minLength > 0) params.set('minLength', newFilters.minLength.toString());
    if (newFilters.maxLength < 24) params.set('maxLength', newFilters.maxLength.toString());
    if (newFilters.minWeight > 0) params.set('minWeight', newFilters.minWeight.toString());
    if (newFilters.maxWeight < 10) params.set('maxWeight', newFilters.maxWeight.toString());
    if (newFilters.inStock) params.set('inStock', 'true');
    if (newFilters.onSale) params.set('onSale', 'true');
    if (newFilters.productType) params.set('productType', newFilters.productType);
    if (newSort !== 'newest') params.set('sort', newSort);

    // If no filters/search but in browse mode, keep browse param to hide hero
    if (params.toString() === '' && isInBrowseMode.current) {
      params.set('browse', '1');
    }

    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });

    // Scroll to the products heading (not the top of the page)
    const productsHeading = document.getElementById('products');
    if (productsHeading) {
      productsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pathname, router, searchQuery]);

  // Fetch products from API
  const fetchProducts = useCallback(async (
    filterParams: {
      category: string;
      brand: string;
      color: string;
      material: string;
      minPrice: number;
      maxPrice: number;
      minLength: number;
      maxLength: number;
      minWeight: number;
      maxWeight: number;
      inStock: boolean;
      onSale: boolean;
      productType: string;
      sort: SortOption;
      search?: string;
    },
    afterCursor?: string | null,
    offset?: number // For search pagination
  ) => {
    const isAppending = !!(afterCursor || (filterParams.search && offset !== undefined && offset > 0));
    isLoadingMore.current = isAppending;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '24');

      // For search queries, use offset-based pagination
      if (filterParams.search && offset !== undefined && offset > 0) {
        params.set('offset', offset.toString());
      } else if (afterCursor) {
        // For non-search queries, use cursor-based pagination
        params.set('after', afterCursor);
      }

      if (filterParams.search) params.set('search', filterParams.search);
      if (filterParams.category) params.set('category', filterParams.category);
      if (filterParams.brand) params.set('brand', filterParams.brand);
      if (filterParams.color) params.set('color', filterParams.color);
      if (filterParams.material) params.set('material', filterParams.material);
      if (filterParams.minPrice > 0) params.set('minPrice', filterParams.minPrice.toString());
      if (filterParams.maxPrice > 0) params.set('maxPrice', filterParams.maxPrice.toString());
      if (filterParams.minLength > 0) params.set('minLength', filterParams.minLength.toString());
      if (filterParams.maxLength < 24) params.set('maxLength', filterParams.maxLength.toString());
      if (filterParams.minWeight > 0) params.set('minWeight', filterParams.minWeight.toString());
      if (filterParams.maxWeight < 10) params.set('maxWeight', filterParams.maxWeight.toString());
      if (filterParams.inStock) params.set('inStock', 'true');
      if (filterParams.onSale) params.set('onSale', 'true');
      if (filterParams.productType) params.set('productType', filterParams.productType);
      if (filterParams.sort !== 'newest') params.set('sort', filterParams.sort);

      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();

      if (data.products) {
        // For search "load more", append products and update offset
        if (filterParams.search && offset !== undefined && offset > 0) {
          setProducts((prev) => [...prev, ...data.products]);
          setSearchOffset((prev) => prev + data.products.length);
        } else if (afterCursor) {
          setProducts((prev) => [...prev, ...data.products]);
        } else {
          setProducts(data.products);
          // Reset search offset when doing a fresh search
          if (filterParams.search) {
            setSearchOffset(data.products.length);
          }
          // Update total count for fresh queries (not load more)
          if (data.total !== undefined) {
            setTotalCount(data.total);
          }

          // Faceted search: update filter options based on context and current selections
          const baseContext = baseFilterOptions.current;
          const contextChanged =
            baseContext.search !== filterParams.search ||
            baseContext.category !== filterParams.category;

          if (contextChanged) {
            // Search/category changed - update base options
            if (data.availableBrands) {
              baseFilterOptions.current.brands = data.availableBrands;
              setAvailableBrands(data.availableBrands);
            }
            if (data.availableMaterials) {
              baseFilterOptions.current.materials = data.availableMaterials;
              setAvailableMaterials(data.availableMaterials);
            }
            if (data.availableColors) {
              baseFilterOptions.current.colors = data.availableColors;
              setAvailableColors(data.availableColors);
            }
            baseFilterOptions.current.search = filterParams.search;
            baseFilterOptions.current.category = filterParams.category;
          } else if (data.availableBrands || data.availableMaterials || data.availableColors) {
            // Same context but filters applied - faceted update
            // Keep base options for selected filters, update others from filtered results
            const hasBrandFilter = !!filterParams.brand;
            const hasMaterialFilter = !!filterParams.material;
            const hasColorFilter = !!filterParams.color;

            // Brands: show base options if brand is selected, otherwise show filtered
            if (hasBrandFilter) {
              setAvailableBrands(baseFilterOptions.current.brands);
            } else if (data.availableBrands) {
              setAvailableBrands(data.availableBrands);
            }

            // Materials: show base options if material is selected, otherwise show filtered
            if (hasMaterialFilter) {
              setAvailableMaterials(baseFilterOptions.current.materials);
            } else if (data.availableMaterials) {
              setAvailableMaterials(data.availableMaterials);
            }

            // Colors: show base options if color is selected, otherwise show filtered
            if (hasColorFilter) {
              setAvailableColors(baseFilterOptions.current.colors);
            } else if (data.availableColors) {
              setAvailableColors(data.availableColors);
            }
          }
        }
        setHasMore(data.pageInfo?.hasNextPage || false);
        setCursor(data.pageInfo?.endCursor || null);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch products when filters change (skip initial mount - server handles initial load)
  useEffect(() => {
    // Skip initial mount - server already provides filtered products
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Skip fetch if restored from navigation cache
    if (restoredFromCache.current) {
      restoredFromCache.current = false;
      return;
    }

    // Skip fetch if we have search results from SSR and no filters applied
    // This prevents re-fetching on hydration/Strict Mode double-render
    if (hasInitialSearchResults.current) {
      const hasFilters = categoryFilter || brandFilter || colorFilter || materialFilter || minPriceFilter > 0 || maxPriceFilter > 0 || minLengthFilter > 0 || maxLengthFilter < 24 || minWeightFilter > 0 || maxWeightFilter < 10 || inStockFilter || onSaleFilter || productTypeFilter || sortBy !== 'newest';
      if (!hasFilters) {
        // Clear the flag so subsequent filter changes will fetch
        hasInitialSearchResults.current = false;
        return;
      }
      hasInitialSearchResults.current = false;
    }

    // Reset cursor and fetch when filters change
    // Include search query if present
    setCursor(null);
    fetchProducts({
      category: categoryFilter,
      brand: brandFilter,
      color: colorFilter,
      material: materialFilter,
      minPrice: minPriceFilter,
      maxPrice: maxPriceFilter,
      minLength: minLengthFilter,
      maxLength: maxLengthFilter,
      minWeight: minWeightFilter,
      maxWeight: maxWeightFilter,
      inStock: inStockFilter,
      onSale: onSaleFilter,
      productType: productTypeFilter,
      sort: sortBy,
      search: searchQuery,
    });
  }, [categoryFilter, brandFilter, colorFilter, materialFilter, minPriceFilter, maxPriceFilter, minLengthFilter, maxLengthFilter, minWeightFilter, maxWeightFilter, inStockFilter, onSaleFilter, productTypeFilter, sortBy, searchQuery, fetchProducts]);

  // Update navigation cache when product state settles
  useEffect(() => {
    if (products.length > 0 && !isLoading) {
      productCache = {
        key: getCacheKey(pathname, searchParams),
        products,
        totalCount,
        hasMore,
        cursor,
        searchOffset,
        brands: availableBrands,
        materials: availableMaterials,
        colors: availableColors,
      };
    }
  }, [products, totalCount, hasMore, cursor, searchOffset, availableBrands, availableMaterials, availableColors, isLoading, pathname, searchParams]);

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

  // Clear search - go to /shop but keep other active filters
  const handleClearSearch = () => {
    const params = new URLSearchParams();

    // Preserve all non-search filters
    if (filters.category) params.set('category', filters.category);
    if (filters.brand) params.set('brand', filters.brand);
    if (filters.color) params.set('color', filters.color);
    if (filters.material) params.set('material', filters.material);
    if (filters.minPrice > 0) params.set('minPrice', filters.minPrice.toString());
    if (filters.maxPrice > 0) params.set('maxPrice', filters.maxPrice.toString());
    if (filters.minLength > 0) params.set('minLength', filters.minLength.toString());
    if (filters.maxLength < 24) params.set('maxLength', filters.maxLength.toString());
    if (filters.minWeight > 0) params.set('minWeight', filters.minWeight.toString());
    if (filters.maxWeight < 10) params.set('maxWeight', filters.maxWeight.toString());
    if (filters.inStock) params.set('inStock', 'true');
    if (filters.onSale) params.set('onSale', 'true');
    if (filters.productType) params.set('productType', filters.productType);
    if (sortBy !== 'newest') params.set('sort', sortBy);

    // If no other filters, keep browse param to hide hero
    if (params.toString() === '') {
      params.set('browse', '1');
    }

    const queryString = params.toString();
    router.replace(`/shop?${queryString}`, { scroll: false });
  };

  // Remove single filter
  const handleRemoveFilter = (key: keyof FilterState) => {
    const newFilters = { ...filters };
    if (key === 'minPrice' || key === 'maxPrice') {
      newFilters.minPrice = 0;
      newFilters.maxPrice = 0;
    } else if (key === 'minLength' || key === 'maxLength') {
      newFilters.minLength = 0;
      newFilters.maxLength = 24;
    } else if (key === 'minWeight' || key === 'maxWeight') {
      newFilters.minWeight = 0;
      newFilters.maxWeight = 10;
    } else if (key === 'category') {
      newFilters.category = '';
    } else if (key === 'brand') {
      newFilters.brand = '';
    } else if (key === 'color') {
      newFilters.color = '';
    } else if (key === 'material') {
      newFilters.material = '';
    } else if (key === 'inStock') {
      newFilters.inStock = false;
    } else if (key === 'onSale') {
      newFilters.onSale = false;
    } else if (key === 'productType') {
      newFilters.productType = '';
    }
    updateURL(newFilters, sortBy);
  };

  // Load more products
  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMore) return;

    // For search queries, use offset-based pagination
    if (searchQuery) {
      fetchProducts({
        category: categoryFilter,
        brand: brandFilter,
        color: colorFilter,
        material: materialFilter,
        minPrice: minPriceFilter,
        maxPrice: maxPriceFilter,
        minLength: minLengthFilter,
        maxLength: maxLengthFilter,
        minWeight: minWeightFilter,
        maxWeight: maxWeightFilter,
        inStock: inStockFilter,
        onSale: onSaleFilter,
        productType: productTypeFilter,
        sort: sortBy,
        search: searchQuery,
      }, null, searchOffset);
    } else {
      // For non-search queries, use cursor-based pagination
      fetchProducts({
        category: categoryFilter,
        brand: brandFilter,
        color: colorFilter,
        material: materialFilter,
        minPrice: minPriceFilter,
        maxPrice: maxPriceFilter,
        minLength: minLengthFilter,
        maxLength: maxLengthFilter,
        minWeight: minWeightFilter,
        maxWeight: maxWeightFilter,
        inStock: inStockFilter,
        onSale: onSaleFilter,
        productType: productTypeFilter,
        sort: sortBy,
        search: searchQuery,
      }, cursor);
    }
  }, [isLoading, hasMore, searchQuery, categoryFilter, brandFilter, colorFilter, materialFilter, minPriceFilter, maxPriceFilter, minLengthFilter, maxLengthFilter, minWeightFilter, maxWeightFilter, inStockFilter, onSaleFilter, productTypeFilter, sortBy, searchOffset, cursor, fetchProducts]);

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

  // Infinite scroll: auto-load more when sentinel comes into view
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoading) {
          handleLoadMore();
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, handleLoadMore]);

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
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin">
          <h2 className="text-lg font-semibold text-foreground mb-4">Filters</h2>
          <FilterPanel
            categories={categories}
            brands={availableBrands}
            colors={availableColors}
            materials={availableMaterials}
            filters={filters}
            onFilterChange={handleFilterChange}
            onClearFilters={handleClearFilters}
            initialCategory={initialCategory}
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
              className="lg:hidden flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-input rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-sm font-medium">Filters</span>
            </button>

            {/* Results Count */}
            <p className="text-sm text-muted-foreground">
              Showing {totalCount} {totalCount === 1 ? 'product' : 'products'}
            </p>
          </div>

          {/* Sort Dropdown */}
          <SortDropdown value={sortBy} onChange={handleSortChange} />
        </div>

        {/* Active Filters */}
        <ActiveFilters
          filters={filters}
          categories={categories}
          brands={availableBrands.length > 0 ? availableBrands : brands}
          colors={availableColors.length > 0 ? availableColors : colors}
          materials={availableMaterials.length > 0 ? availableMaterials : materials}
          searchQuery={searchQuery}
          onRemoveFilter={handleRemoveFilter}
          onClearSearch={handleClearSearch}
          onClearAll={handleClearFilters}
        />

        {/* Products Grid */}
        {isLoading && products.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-4 sm:gap-6">
            {[...Array(10)].map((_, i) => (
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
        ) : products.length > 0 ? (
          <>
            <div className="relative">
              {/* Loading overlay when re-fetching with filters (not for infinite scroll) */}
              {isLoading && !isLoadingMore.current && (
                <div className="absolute inset-0 bg-background/60 z-10 flex items-start justify-center pt-24">
                  <div className="flex items-center gap-2 px-4 py-2 bg-card rounded-lg shadow-md border border-border">
                    <svg className="animate-spin h-4 w-4 text-primary" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm text-muted-foreground">Updating results...</span>
                  </div>
                </div>
              )}
              <div className={`grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-4 sm:gap-6 transition-opacity duration-200 ${isLoading && !isLoadingMore.current ? 'opacity-40 pointer-events-none' : ''}`}>
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </div>

            {/* Load More / Infinite Scroll Sentinel */}
            {hasMore && (
              <div className="mt-12 text-center">
                {/* Sentinel for IntersectionObserver auto-loading */}
                <div ref={loadMoreSentinelRef} aria-hidden="true" />
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading more products...
                  </div>
                ) : (
                  <button
                    onClick={handleLoadMore}
                    className="px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
                  >
                    Load More Products
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
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
      <div
        className={`fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300 ${
          isMobileFilterOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileFilterOpen(false)}
      />
      <div
        className={`fixed inset-y-0 left-0 w-full max-w-sm bg-background z-50 lg:hidden overflow-y-auto transition-transform duration-300 ease-out ${
          isMobileFilterOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <FilterPanel
          categories={categories}
          brands={availableBrands}
          colors={availableColors}
          materials={availableMaterials}
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isMobile
          onClose={() => setIsMobileFilterOpen(false)}
          initialCategory={initialCategory}
        />
      </div>
    </div>
  );
}
