'use client';

import { useState, useCallback } from 'react';

// Hierarchical category interface
export interface HierarchicalCategory {
  id: string;
  name: string;
  slug: string;
  count: number;
  children: HierarchicalCategory[];
}

interface CategoryFilterProps {
  categories: HierarchicalCategory[];
  selectedCategory: string;
  onSelect: (category: string) => void;
  /** When set, only show subcategories of this category (for category pages) */
  initialCategory?: string;
}

// Recursively find a category by slug
function findCategory(categories: HierarchicalCategory[], slug: string): HierarchicalCategory | null {
  for (const cat of categories) {
    if (cat.slug === slug) return cat;
    const found = findCategory(cat.children, slug);
    if (found) return found;
  }
  return null;
}

export default function CategoryFilter({
  categories,
  selectedCategory,
  onSelect,
  initialCategory,
}: CategoryFilterProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Toggle expansion state of a category
  const toggleExpand = useCallback((slug: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  // Handle category selection - select and expand to show children
  const handleSelect = useCallback((slug: string, hasChildren: boolean) => {
    onSelect(slug);
    if (hasChildren) {
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
    }
  }, [onSelect]);

  // Check if a category or any of its ancestors is selected
  const isInSelectedPath = useCallback((category: HierarchicalCategory): boolean => {
    if (category.slug === selectedCategory) return true;
    return category.children.some((child) => isInSelectedPath(child));
  }, [selectedCategory]);

  // Render a single category item
  const CategoryItem = ({
    category,
    level = 0,
  }: {
    category: HierarchicalCategory;
    level?: number;
  }) => {
    const hasChildren = category.children.length > 0;
    const isExpanded = expandedCategories.has(category.slug);
    const isSelected = selectedCategory === category.slug;
    const isInPath = isInSelectedPath(category);

    return (
      <div>
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: `${level * 12}px` }}
        >
          {/* Expand/Collapse button */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(category.slug);
              }}
              className="p-1 hover:bg-muted rounded transition-colors flex-shrink-0"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <svg
                className={`w-3 h-3 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          ) : (
            <span className="w-5" /> // Spacer for alignment
          )}

          {/* Category button */}
          <button
            onClick={() => handleSelect(category.slug, hasChildren)}
            className={`flex-1 text-left px-2 py-1.5 text-sm rounded-lg transition-colors ${
              isSelected
                ? 'bg-primary/10 text-primary font-medium'
                : isInPath && !isSelected
                ? 'text-primary/70'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {category.name}
          </button>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {category.children.map((child) => (
              <CategoryItem key={child.id} category={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  // When on a category page, scope to subcategories of that category
  const scopedCategory = initialCategory ? findCategory(categories, initialCategory) : null;
  const displayCategories = scopedCategory?.children.length ? scopedCategory.children : categories;
  const allLabel = scopedCategory ? `All ${scopedCategory.name}` : 'All Categories';

  return (
    <div className="pt-3 space-y-3">
      {/* All Categories / Scoped Category Option */}
      <button
        onClick={() => onSelect(initialCategory || '')}
        className={`flex items-center w-full px-3 py-2 text-sm rounded-lg transition-colors ${
          selectedCategory === (initialCategory || '')
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <span>{allLabel}</span>
      </button>

      {/* Category List */}
      <div className="max-h-80 overflow-y-auto space-y-0.5">
        {displayCategories.map((category) => (
          <CategoryItem key={category.id} category={category} />
        ))}
      </div>

      {/* Link to browse all categories (only on category pages) */}
      {scopedCategory && (
        <a
          href="/shop"
          className="block text-center text-xs text-muted-foreground hover:text-primary transition-colors pt-2 border-t border-border"
        >
          Browse all categories
        </a>
      )}
    </div>
  );
}
