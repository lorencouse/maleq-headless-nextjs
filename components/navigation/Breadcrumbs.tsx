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
    ? 'link-subtle-light text-xs sm:text-sm'
    : 'link-subtle text-xs sm:text-sm';
  const currentClass = isLight
    ? 'link-current-light text-xs sm:text-sm'
    : 'link-current text-xs sm:text-sm';
  const separatorClass = isLight
    ? 'text-white/40'
    : 'text-muted-foreground/40';

  // Build all breadcrumb parts including Home
  const allItems = [{ label: 'Home', href: '/' }, ...items];

  return (
    <nav aria-label="Breadcrumb" className="mb-2 sm:mb-4">
      <ol className="flex flex-wrap items-baseline gap-x-1 sm:gap-x-1.5 leading-none">
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
                <span className={`mx-1 sm:mx-1.5 text-xs sm:text-sm ${separatorClass}`} aria-hidden="true">/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
