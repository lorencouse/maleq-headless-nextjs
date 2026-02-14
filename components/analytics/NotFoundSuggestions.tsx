'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface Suggestion {
  name: string;
  url: string;
  type: 'product' | 'category' | 'blog' | 'brand' | 'blog-category';
  image?: string | null;
}

const TYPE_LABELS: Record<Suggestion['type'], string> = {
  product: 'Product',
  category: 'Category',
  blog: 'Guide',
  brand: 'Brand',
  'blog-category': 'Topic',
};

function SuggestionSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border border-border animate-pulse">
      <div className="w-16 h-16 bg-muted rounded-md shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/4" />
      </div>
    </div>
  );
}

export default function NotFoundSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = window.location.pathname;

    fetch(`/api/suggest-404?path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((data) => {
        setSuggestions(data.suggestions || []);
      })
      .catch(() => {
        // Silently fail — suggestions are non-critical
      })
      .finally(() => setLoading(false));
  }, []);

  if (!loading && suggestions.length === 0) return null;

  return (
    <div className="w-full max-w-lg mx-auto mb-8">
      <p className="text-sm text-muted-foreground mb-3">
        Were you looking for one of these?
      </p>
      <div className="space-y-2">
        {loading ? (
          <>
            <SuggestionSkeleton />
            <SuggestionSkeleton />
            <SuggestionSkeleton />
          </>
        ) : (
          suggestions.map((s) => (
            <Link
              key={s.url}
              href={s.url}
              className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors"
            >
              {s.image ? (
                <div className="relative w-16 h-16 shrink-0 rounded-md overflow-hidden bg-muted">
                  <Image
                    src={s.image}
                    alt={s.name}
                    fill
                    className="object-cover"
                    sizes="64px"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 shrink-0 rounded-md bg-muted flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-muted-foreground/50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.15c0 .415.336.75.75.75z"
                    />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {s.name}
                </p>
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABELS[s.type]}
                </span>
              </div>
              <svg
                className="w-4 h-4 text-muted-foreground shrink-0"
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
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
