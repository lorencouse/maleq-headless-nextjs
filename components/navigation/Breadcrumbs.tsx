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

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol
        className="flex items-center flex-wrap gap-1 text-sm"
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
            className={isLight ? 'link-subtle-light' : 'link-subtle'}
          >
            <span itemProp="name">Home</span>
          </Link>
          <meta itemProp="position" content="1" />
          <span className={`mx-2 ${isLight ? 'text-white/50' : 'text-muted-foreground/50'}`}>/</span>
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
              className="flex items-center"
            >
              {isLast || !item.href ? (
                <span
                  itemProp="name"
                  className={isLight ? 'link-current-light' : 'link-current'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  itemProp="item"
                  className={isLight ? 'link-subtle-light' : 'link-subtle'}
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              )}
              <meta itemProp="position" content={position.toString()} />
              {!isLast && (
                <span className={`mx-2 ${isLight ? 'text-white/50' : 'text-muted-foreground/50'}`}>/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
