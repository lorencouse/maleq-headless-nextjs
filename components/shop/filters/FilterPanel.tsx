'use client';

import { useState } from 'react';
import PriceRangeFilter from './PriceRangeFilter';
import CategoryFilter, { HierarchicalCategory } from './CategoryFilter';
import StockFilter from './StockFilter';
import SelectFilter from './SelectFilter';
import type { FilterOption } from '@/lib/products/combined-service';

export interface FilterState {
  category: string;
  brand: string;
  color: string;
  material: string;
  minPrice: number;
  maxPrice: number;
  inStock: boolean;
  onSale: boolean;
}

interface FilterPanelProps {
  categories: HierarchicalCategory[];
  brands?: FilterOption[];
  colors?: FilterOption[];
  materials?: FilterOption[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
  onClose?: () => void;
}

export default function FilterPanel({
  categories,
  brands = [],
  colors = [],
  materials = [],
  filters,
  onFilterChange,
  onClearFilters,
  isMobile = false,
  onClose,
}: FilterPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    category: true,
    brand: true,
    color: false,
    material: false,
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
    filters.brand !== '' ||
    filters.color !== '' ||
    filters.material !== '' ||
    filters.minPrice > 0 ||
    filters.maxPrice < 500 ||
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

      {/* Brand */}
      {brands.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('brand')}
            className="flex justify-between items-center w-full py-2 text-left"
          >
            <span className="font-semibold text-foreground">Brand</span>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform ${
                expandedSections.brand ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.brand && (
            <SelectFilter
              options={brands}
              selectedValue={filters.brand}
              onSelect={(brand) => onFilterChange({ ...filters, brand })}
              placeholder="All Brands"
            />
          )}
        </div>
      )}

      {/* Color */}
      {colors.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('color')}
            className="flex justify-between items-center w-full py-2 text-left"
          >
            <span className="font-semibold text-foreground">Color</span>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform ${
                expandedSections.color ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.color && (
            <SelectFilter
              options={colors}
              selectedValue={filters.color}
              onSelect={(color) => onFilterChange({ ...filters, color })}
              placeholder="All Colors"
            />
          )}
        </div>
      )}

      {/* Material */}
      {materials.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => toggleSection('material')}
            className="flex justify-between items-center w-full py-2 text-left"
          >
            <span className="font-semibold text-foreground">Material</span>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform ${
                expandedSections.material ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.material && (
            <SelectFilter
              options={materials}
              selectedValue={filters.material}
              onSelect={(material) => onFilterChange({ ...filters, material })}
              placeholder="All Materials"
            />
          )}
        </div>
      )}

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
