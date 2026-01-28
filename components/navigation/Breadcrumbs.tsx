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
    ? 'text-white/80 hover:text-white'
    : 'text-muted-foreground hover:text-foreground';
  const currentClass = isLight
    ? 'text-white font-medium'
    : 'text-foreground font-medium';
  const separatorClass = isLight
    ? 'text-white/40'
    : 'text-muted-foreground/40';

  return (
    <nav aria-label="Breadcrumb" className="mb-2 sm:mb-4">
      <ol
        className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm"
        itemScope
        itemType="https://schema.org/BreadcrumbList"
      >
        {/* Home is always first */}
        <li
          itemProp="itemListElement"
          itemScope
          itemType="https://schema.org/ListItem"
          className="flex items-center"
        >
          <Link
            href="/"
            itemProp="item"
            className={linkClass}
          >
            <span itemProp="name">Home</span>
          </Link>
          <meta itemProp="position" content="1" />
          <span className={`ml-1 sm:ml-1.5 ${separatorClass}`}>/</span>
        </li>

        {/* Dynamic items */}
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const position = index + 2; // +2 because Home is position 1

          return (
            <li
              key={item.label}
              itemProp="itemListElement"
              itemScope
              itemType="https://schema.org/ListItem"
              className="flex items-center min-w-0"
            >
              {isLast || !item.href ? (
                <span
                  itemProp="name"
                  className={`${currentClass} truncate`}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  itemProp="item"
                  className={`${linkClass} truncate`}
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              )}
              <meta itemProp="position" content={position.toString()} />
              {!isLast && (
                <span className={`ml-1 sm:ml-1.5 flex-shrink-0 ${separatorClass}`}>/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
