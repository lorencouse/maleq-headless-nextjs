'use client';

import Link from 'next/link';

interface DidYouMeanProps {
  /** Array of spelling/search suggestions */
  suggestions: string[];
  /** Base URL path for suggestion links (e.g., "/shop" or "/blog") */
  basePath: string;
  /** Query parameter name (default: "q") */
  queryParam?: string;
  /** Alignment of the component (default: "right") */
  align?: 'left' | 'center' | 'right';
  /** Additional class names */
  className?: string;
}

/**
 * Reusable "Did you mean?" component for search suggestions
 * Shows spelling corrections and alternative search terms
 */
export default function DidYouMean({
  suggestions,
  basePath,
  queryParam = 'q',
  align = 'right',
  className = '',
}: DidYouMeanProps) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const alignmentClass = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
  }[align];

  return (
    <div className={`mb-3 p-3 bg-muted/50 border border-border rounded-lg flex ${alignmentClass} ${className}`}>
      <p className="text-sm text-foreground">
        Did you mean:{' '}
        {suggestions.map((suggestion, index) => (
          <span key={suggestion}>
            <Link
              href={`${basePath}?${queryParam}=${encodeURIComponent(suggestion)}`}
              className="font-semibold text-primary hover:text-primary/80 underline"
            >
              {suggestion}
            </Link>
            {index < suggestions.length - 1 && ', '}
          </span>
        ))}
        ?
      </p>
    </div>
  );
}

/**
 * Inline version for use in dropdowns/autocomplete
 * More compact styling
 */
export function DidYouMeanInline({
  suggestions,
  onSelect,
  className = '',
}: {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  className?: string;
}) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={`px-3 py-2 border-t border-border bg-muted/30 ${className}`}>
      <p className="text-xs text-muted-foreground">
        Did you mean:{' '}
        {suggestions.map((suggestion, index) => (
          <span key={suggestion}>
            <button
              onClick={() => onSelect(suggestion)}
              className="font-medium text-primary hover:text-primary/80 underline"
            >
              {suggestion}
            </button>
            {index < suggestions.length - 1 && ', '}
          </span>
        ))}
        ?
      </p>
    </div>
  );
}
