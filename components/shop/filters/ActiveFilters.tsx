'use client';

import { FilterState } from './FilterPanel';

interface ActiveFiltersProps {
  filters: FilterState;
  categories: { id: string; name: string; slug: string }[];
  onRemoveFilter: (key: keyof FilterState) => void;
  onClearAll: () => void;
}

export default function ActiveFilters({
  filters,
  categories,
  onRemoveFilter,
  onClearAll,
}: ActiveFiltersProps) {
  const activeFilters: { key: keyof FilterState; label: string }[] = [];

  if (filters.category) {
    const categoryName = categories.find((c) => c.slug === filters.category)?.name || filters.category;
    activeFilters.push({ key: 'category', label: `Category: ${categoryName}` });
  }

  if (filters.minPrice > 0 || filters.maxPrice < 500) {
    activeFilters.push({
      key: 'minPrice',
      label: `$${filters.minPrice} - $${filters.maxPrice}`,
    });
  }

  if (filters.inStock) {
    activeFilters.push({ key: 'inStock', label: 'In Stock' });
  }

  if (filters.onSale) {
    activeFilters.push({ key: 'onSale', label: 'On Sale' });
  }

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-sm text-muted-foreground">Active filters:</span>
      {activeFilters.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onRemoveFilter(key)}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full hover:bg-primary/20 transition-colors"
        >
          {label}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ))}
      <button
        onClick={onClearAll}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors underline"
      >
        Clear all
      </button>
    </div>
  );
}
