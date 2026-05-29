'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLocalizedCategoryName } from '@/lib/i18n/category-translations';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /**
   * Optional full i18n key (e.g. 'productSlugPage.breadcrumbShop') for static
   * segments. When set, the label is resolved client-side in the active locale
   * — so breadcrumbs on English-pinned content-root pages still localize when
   * the user switches language via the chrome cookie.
   */
  labelKey?: string;
  /** Optional product-category slug — localizes the label via the category dictionary. */
  categorySlug?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Use light variant for dark backgrounds (e.g., hero sections) */
  variant?: 'default' | 'light';
}

export default function Breadcrumbs({ items, variant = 'default' }: BreadcrumbsProps) {
  const t = useTranslations();
  const localizeCategoryName = useLocalizedCategoryName();
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

  // Build all breadcrumb parts including Home (localized via common.home).
  const allItems: BreadcrumbItem[] = [
    { label: 'Home', labelKey: 'common.home', href: '/' },
    ...items,
  ];

  // Resolve each item's display label in the active locale: category dictionary
  // → i18n key → raw label fallback.
  const displayLabel = (item: BreadcrumbItem) =>
    item.categorySlug
      ? localizeCategoryName(item.categorySlug, item.label)
      : item.labelKey
        ? t(item.labelKey)
        : item.label;

  return (
    <nav aria-label="Breadcrumb" className="mb-2 sm:mb-4">
      <ol className="flex items-baseline overflow-hidden leading-none">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;
          const label = displayLabel(item);

          return (
            <li
              key={`${item.label}-${index}`}
              className={`inline-flex items-baseline ${isLast ? 'min-w-0' : 'flex-shrink-0'}`}
            >
              {isLast || !item.href ? (
                <span
                  className={`${currentClass} ${isLast ? 'truncate' : ''}`}
                  aria-current={isLast ? 'page' : undefined}
                  title={isLast ? label : undefined}
                >
                  {label}
                </span>
              ) : (
                <Link href={item.href} className={`${linkClass} whitespace-nowrap`}>
                  {label}
                </Link>
              )}
              {!isLast && (
                <span className={`mx-1 sm:mx-1.5 text-xs sm:text-sm flex-shrink-0 ${separatorClass}`} aria-hidden="true">/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
