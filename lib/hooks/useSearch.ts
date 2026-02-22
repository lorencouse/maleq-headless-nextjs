'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchOfflineProducts } from '@/lib/pwa/offline-search';

interface ProductSearchResult {
  products: Array<{
    id: string;
    name: string;
    slug: string;
    price: string | null;
    image: string | null;
  }>;
  categories: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  correctedTerm?: string;
  offline?: boolean;
}

interface BlogSearchResult {
  posts: Array<{
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    image: string | null;
    category: string | null;
  }>;
  categories: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  correctedTerm?: string;
}

/**
 * React Query hook for product search suggestions.
 * Falls back to offline IndexedDB search when network is unavailable.
 */
export function useProductSearch(query: string, limit = 5) {
  return useQuery<ProductSearchResult>({
    queryKey: ['productSearch', query, limit],
    queryFn: async () => {
      // Try network first
      if (navigator.onLine) {
        try {
          const response = await fetch(
            `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`
          );
          if (response.ok) {
            return response.json();
          }
        } catch {
          // Network error — fall through to offline search
        }
      }

      // Offline fallback: search IndexedDB products
      const results = await searchOfflineProducts(query, limit);
      return {
        products: results.map((r) => ({
          id: r.slug,
          name: r.name,
          slug: r.slug,
          price: r.price,
          image: r.image?.url || null,
        })),
        categories: [],
        offline: true,
      };
    },
    enabled: query.length >= 2,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * React Query hook for blog search suggestions
 * Includes caching, deduplication, and automatic refetching
 */
export function useBlogSearch(query: string, limit = 5) {
  return useQuery<BlogSearchResult>({
    queryKey: ['blogSearch', query, limit],
    queryFn: async () => {
      const response = await fetch(
        `/api/blog/search?q=${encodeURIComponent(query)}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error('Search failed');
      }
      return response.json();
    },
    enabled: query.length >= 2,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Debounce hook for search input
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
