'use client';

import { useState } from 'react';

interface Category {
  id: string;
  name: string;
  slug: string;
  count?: number;
}

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onSelect: (category: string) => void;
}

export default function CategoryFilter({
  categories,
  selectedCategory,
  onSelect,
}: CategoryFilterProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="pt-3 space-y-3">
      {/* Search Categories */}
      {categories.length > 10 && (
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search categories..."
            className="w-full pl-9 pr-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-sm"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
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
        </div>
      )}

      {/* All Categories Option */}
      <button
        onClick={() => onSelect('')}
        className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors ${
          selectedCategory === ''
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <span>All Categories</span>
      </button>

      {/* Category List */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {filteredCategories.map((category) => (
          <button
            key={category.id}
            onClick={() => onSelect(category.slug)}
            className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors ${
              selectedCategory === category.slug
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <span>{category.name}</span>
            {category.count !== undefined && (
              <span className="text-xs text-muted-foreground">({category.count})</span>
            )}
          </button>
        ))}

        {filteredCategories.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">No categories found</p>
        )}
      </div>
    </div>
  );
}
