'use client';

import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Use light variant for dark backgrounds (e.g., hero sections) */
  variant?: 'default' | 'light';
}

export default function Breadcrumbs({ items, variant = 'default' }: BreadcrumbsProps) {
  const isLight = variant === 'light';

  const linkClass = isLight
    ? 'text-white/80 hover:text-white transition-colors'
    : 'text-muted-foreground hover:text-foreground transition-colors';
  const currentClass = isLight
    ? 'text-white font-medium'
    : 'text-foreground font-medium';
  const separatorClass = isLight
    ? 'text-white/40'
    : 'text-muted-foreground/40';

  // Build all breadcrumb parts including Home
  const allItems = [{ label: 'Home', href: '/' }, ...items];

  return (
    <nav aria-label="Breadcrumb" className="mb-2 sm:mb-4">
      <ol className="flex flex-wrap items-baseline gap-x-1 sm:gap-x-1.5 text-xs sm:text-sm leading-none">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-baseline">
              {isLast || !item.href ? (
                <span
                  className={currentClass}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              )}
              {!isLast && (
                <span className={`mx-1 sm:mx-1.5 ${separatorClass}`} aria-hidden="true">/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
