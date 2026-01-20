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
}

export default function CategoryFilter({
  categories,
  selectedCategory,
  onSelect,
}: CategoryFilterProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

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

  // Flatten categories for search
  const flattenCategories = useCallback((cats: HierarchicalCategory[]): HierarchicalCategory[] => {
    return cats.reduce((acc: HierarchicalCategory[], cat) => {
      acc.push(cat);
      if (cat.children.length > 0) {
        acc.push(...flattenCategories(cat.children));
      }
      return acc;
    }, []);
  }, []);

  // Filter categories by search term
  const searchResults = searchTerm
    ? flattenCategories(categories).filter((cat) =>
        cat.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

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

  // Total category count for showing search
  const totalCategories = flattenCategories(categories).length;

  return (
    <div className="pt-3 space-y-3">
      {/* Search Categories */}
      {totalCategories > 10 && (
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10"
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
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-8 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm placeholder:text-muted-foreground/60"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors z-10"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* All Categories Option */}
      <button
        onClick={() => onSelect('')}
        className={`flex items-center w-full px-3 py-2 text-sm rounded-lg transition-colors ${
          selectedCategory === ''
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <span>All Categories</span>
      </button>

      {/* Category List */}
      <div className="max-h-80 overflow-y-auto space-y-0.5">
        {searchTerm ? (
          // Search results (flat list)
          <>
            {searchResults.map((category) => (
              <button
                key={category.id}
                onClick={() => handleSelect(category.slug, category.children.length > 0)}
                className={`flex items-center w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                  selectedCategory === category.slug
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {category.name}
              </button>
            ))}
            {searchResults.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No categories found
              </p>
            )}
          </>
        ) : (
          // Hierarchical tree view
          categories.map((category) => (
            <CategoryItem key={category.id} category={category} />
          ))
        )}
      </div>
    </div>
  );
}
