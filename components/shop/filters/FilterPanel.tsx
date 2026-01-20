'use client';

import { useState } from 'react';
import PriceRangeFilter from './PriceRangeFilter';
import CategoryFilter, { HierarchicalCategory } from './CategoryFilter';
import StockFilter from './StockFilter';

export interface FilterState {
  category: string;
  minPrice: number;
  maxPrice: number;
  inStock: boolean;
  onSale: boolean;
}

interface FilterPanelProps {
  categories: HierarchicalCategory[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
  onClose?: () => void;
}

export default function FilterPanel({
  categories,
  filters,
  onFilterChange,
  onClearFilters,
  isMobile = false,
  onClose,
}: FilterPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    category: true,
    price: true,
    availability: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const hasActiveFilters =
    filters.category !== '' ||
    filters.minPrice > 0 ||
    filters.maxPrice < 1000 ||
    filters.inStock ||
    filters.onSale;

  return (
    <div className={`${isMobile ? 'p-4' : ''}`}>
      {/* Mobile Header */}
      {isMobile && (
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Filters</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Close filters"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Clear Filters */}
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="w-full mb-4 py-2 px-4 text-sm text-primary hover:text-primary-hover font-medium border border-primary rounded-lg hover:bg-primary/5 transition-colors"
        >
          Clear All Filters
        </button>
      )}

      {/* Categories */}
      <div className="mb-6">
        <button
          onClick={() => toggleSection('category')}
          className="flex justify-between items-center w-full py-2 text-left"
        >
          <span className="font-semibold text-foreground">Category</span>
          <svg
            className={`w-5 h-5 text-muted-foreground transition-transform ${
              expandedSections.category ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSections.category && (
          <CategoryFilter
            categories={categories}
            selectedCategory={filters.category}
            onSelect={(category) => onFilterChange({ ...filters, category })}
          />
        )}
      </div>

      {/* Price Range */}
      <div className="mb-6">
        <button
          onClick={() => toggleSection('price')}
          className="flex justify-between items-center w-full py-2 text-left"
        >
          <span className="font-semibold text-foreground">Price Range</span>
          <svg
            className={`w-5 h-5 text-muted-foreground transition-transform ${
              expandedSections.price ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSections.price && (
          <PriceRangeFilter
            minPrice={filters.minPrice}
            maxPrice={filters.maxPrice}
            onPriceChange={(min, max) => onFilterChange({ ...filters, minPrice: min, maxPrice: max })}
          />
        )}
      </div>

      {/* Availability */}
      <div className="mb-6">
        <button
          onClick={() => toggleSection('availability')}
          className="flex justify-between items-center w-full py-2 text-left"
        >
          <span className="font-semibold text-foreground">Availability</span>
          <svg
            className={`w-5 h-5 text-muted-foreground transition-transform ${
              expandedSections.availability ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSections.availability && (
          <StockFilter
            inStock={filters.inStock}
            onSale={filters.onSale}
            onInStockChange={(value) => onFilterChange({ ...filters, inStock: value })}
            onSaleChange={(value) => onFilterChange({ ...filters, onSale: value })}
          />
        )}
      </div>

      {/* Mobile Apply Button */}
      {isMobile && (
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold mt-4"
        >
          Apply Filters
        </button>
      )}
    </div>
  );
}
