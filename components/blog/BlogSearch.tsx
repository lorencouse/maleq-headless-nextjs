'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface BlogSearchProps {
  categorySlug?: string;
  placeholder?: string;
}

export default function BlogSearch({
  categorySlug,
  placeholder = 'Search articles...',
}: BlogSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [isSearching, setIsSearching] = useState(false);

  // Update URL with search query (debounced)
  const updateSearch = useCallback((searchTerm: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (searchTerm.trim()) {
      params.set('q', searchTerm.trim());
    } else {
      params.delete('q');
    }

    const basePath = categorySlug ? `/blog/category/${categorySlug}` : '/blog';
    const queryString = params.toString();
    router.push(queryString ? `${basePath}?${queryString}` : basePath, { scroll: false });
    setIsSearching(false);
  }, [categorySlug, router, searchParams]);

  // Debounce search
  useEffect(() => {
    if (query === (searchParams.get('q') || '')) {
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(() => {
      updateSearch(query);
    }, 400);

    return () => clearTimeout(timer);
  }, [query, searchParams, updateSearch]);

  const handleClear = () => {
    setQuery('');
    updateSearch('');
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground placeholder:text-muted-foreground"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
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

        {/* Loading indicator */}
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-muted-foreground" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}

        {/* Clear button */}
        {query && !isSearching && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
