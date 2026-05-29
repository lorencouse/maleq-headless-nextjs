'use client';

import { useTranslations } from 'next-intl';
import { FilterState } from './FilterPanel';
import { HierarchicalCategory } from './CategoryFilter';
import { findCategoryBySlug } from '@/lib/utils/category-helpers';
import { useLocalizedCategoryName } from '@/lib/i18n/category-translations';
import { FilterOption } from '@/lib/products/combined-service';

interface ActiveFiltersProps {
  filters: FilterState;
  categories: HierarchicalCategory[];
  brands?: FilterOption[];
  colors?: FilterOption[];
  materials?: FilterOption[];
  searchQuery?: string;
  onRemoveFilter: (key: keyof FilterState) => void;
  onClearSearch?: () => void;
  onClearAll: () => void;
}

// Convert slug to readable name (fallback when option not found)
function formatSlug(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Find option name by slug
function getOptionName(options: FilterOption[] | undefined, slug: string): string {
  const option = options?.find(opt => opt.slug === slug);
  return option?.name || formatSlug(slug);
}

export default function ActiveFilters({
  filters,
  categories,
  brands = [],
  colors = [],
  materials = [],
  searchQuery,
  onRemoveFilter,
  onClearSearch,
  onClearAll,
}: ActiveFiltersProps) {
  const t = useTranslations('filters');
  const localizeCategoryName = useLocalizedCategoryName();
  const activeFilters: { key: keyof FilterState; label: string }[] = [];

  if (filters.category) {
    const category = findCategoryBySlug(categories, filters.category);
    const categoryName = localizeCategoryName(
      filters.category,
      category?.name || formatSlug(filters.category),
    );
    activeFilters.push({ key: 'category', label: t('activeCategoryPill', { name: categoryName }) });
  }

  if (filters.minPrice > 0 || filters.maxPrice > 0) {
    const maxLabel = filters.maxPrice > 0 ? `$${filters.maxPrice}` : t('rangeNoMax');
    activeFilters.push({
      key: 'minPrice',
      label:
        filters.minPrice > 0
          ? t('rangeBetween', { min: `$${filters.minPrice}`, max: maxLabel })
          : t('rangeUpTo', { max: maxLabel }),
    });
  }

  if (filters.minLength > 0 || filters.maxLength < 24) {
    activeFilters.push({
      key: 'minLength',
      label: t('activeLengthPill', { min: filters.minLength, max: filters.maxLength }),
    });
  }

  if (filters.minWeight > 0 || filters.maxWeight < 10) {
    activeFilters.push({
      key: 'minWeight',
      label: t('activeWeightPill', { min: filters.minWeight, max: filters.maxWeight }),
    });
  }

  if (filters.brand) {
    const brandName = getOptionName(brands, filters.brand);
    activeFilters.push({ key: 'brand', label: t('activeBrandPill', { name: brandName }) });
  }

  if (filters.color) {
    const colorName = getOptionName(colors, filters.color);
    activeFilters.push({ key: 'color', label: t('activeColorPill', { name: colorName }) });
  }

  if (filters.material) {
    const materialName = getOptionName(materials, filters.material);
    activeFilters.push({ key: 'material', label: t('activeMaterialPill', { name: materialName }) });
  }

  if (filters.inStock) {
    activeFilters.push({ key: 'inStock', label: t('activeInStock') });
  }

  if (filters.onSale) {
    activeFilters.push({ key: 'onSale', label: t('activeOnSale') });
  }

  if (filters.productType) {
    activeFilters.push({
      key: 'productType',
      label: filters.productType === 'simple' ? t('activeTypeSimple') : t('activeTypeVariable'),
    });
  }

  // Show nothing if no search and no filters
  if (!searchQuery && activeFilters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-sm text-muted-foreground">{t('active')}</span>

      {/* Search query pill */}
      {searchQuery && onClearSearch && (
        <button
          onClick={onClearSearch}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-secondary text-secondary-foreground text-sm rounded-full hover:bg-secondary/80 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          &ldquo;{searchQuery}&rdquo;
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Other filter pills */}
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

      {/* Clear all - only show if there are filters beyond just search */}
      {(activeFilters.length > 0 || (searchQuery && activeFilters.length > 0)) && (
        <button
          onClick={onClearAll}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline"
        >
          {t('activeClearAll')}
        </button>
      )}
    </div>
  );
}
