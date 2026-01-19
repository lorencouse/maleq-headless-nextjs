'use client';

import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol
        className="flex items-center flex-wrap gap-2 text-sm"
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
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <span itemProp="name">Home</span>
          </Link>
          <meta itemProp="position" content="1" />
          <svg
            className="w-4 h-4 mx-2 text-muted-foreground/50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
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
                  className={isLast ? 'text-foreground font-medium' : 'text-muted-foreground'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  itemProp="item"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              )}
              <meta itemProp="position" content={position.toString()} />
              {!isLast && (
                <svg
                  className="w-4 h-4 mx-2 text-muted-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
