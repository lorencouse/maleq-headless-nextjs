'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface PaginationProps {
  /** 1-based current page. */
  currentPage: number;
  /** Known total page count; omit when only "has next" is known. */
  totalPages?: number;
  /** Fallback when totalPages is unknown (cursor-based sources). */
  hasNextPage: boolean;
  /** Path without query string, e.g. `/sex-toys/anal-toys`. */
  basePath: string;
  /** Current query params to preserve (filters/sort). `page` is managed here. */
  query?: Record<string, string>;
  className?: string;
}

/**
 * Server-renderable pagination links for listing pages.
 *
 * Renders real <a href="?page=N"> anchors so crawlers can reach every product
 * and guide, not only the first 24 loaded by the infinite-scroll grid (SEO
 * audit 2026-09-12, finding C3). Page 1 links to the bare path so it
 * canonicalises cleanly.
 */
export default function Pagination({
  currentPage,
  totalPages,
  hasNextPage,
  basePath,
  query = {},
  className = '',
}: PaginationProps) {
  const t = useTranslations('pagination');

  const knownTotal = typeof totalPages === 'number' && totalPages > 0 ? totalPages : undefined;
  const hasPrev = currentPage > 1;
  const hasNext = knownTotal ? currentPage < knownTotal : hasNextPage;

  if (!hasPrev && !hasNext) return null;

  const href = (page: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (k !== 'page' && v) params.set(k, v);
    }
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Compact window: 1 … (c-1) c (c+1) … N
  const pages: (number | 'gap')[] = [];
  if (knownTotal) {
    const want = new Set<number>([1, knownTotal, currentPage - 1, currentPage, currentPage + 1]);
    if (currentPage <= 3) [2, 3, 4].forEach((p) => want.add(p));
    if (currentPage >= knownTotal - 2) [knownTotal - 3, knownTotal - 2, knownTotal - 1].forEach((p) => want.add(p));
    const sorted = [...want].filter((p) => p >= 1 && p <= knownTotal).sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) pages.push('gap');
      pages.push(p);
      prev = p;
    }
  }

  const linkBase =
    'inline-flex items-center justify-center min-w-10 h-10 px-3 rounded-md border text-sm font-medium transition-colors';
  const linkIdle = `${linkBase} border-border bg-card text-foreground hover:border-primary hover:text-primary`;
  const linkCurrent = `${linkBase} border-primary bg-primary text-primary-foreground`;
  const linkDisabled = `${linkBase} border-border text-muted-foreground/50 cursor-not-allowed`;

  return (
    <nav aria-label={t('label')} className={`mt-10 flex flex-wrap items-center justify-center gap-2 ${className}`}>
      {hasPrev ? (
        <Link href={href(currentPage - 1)} rel="prev" className={linkIdle}>
          <span aria-hidden="true" className="mr-1">&lsaquo;</span>
          {t('previous')}
        </Link>
      ) : (
        <span aria-disabled="true" className={linkDisabled}>
          <span aria-hidden="true" className="mr-1">&lsaquo;</span>
          {t('previous')}
        </span>
      )}

      {pages.length > 0 ? (
        <ul className="flex items-center gap-1">
          {pages.map((p, i) =>
            p === 'gap' ? (
              <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
                &hellip;
              </li>
            ) : (
              <li key={p}>
                {p === currentPage ? (
                  <span aria-current="page" className={linkCurrent}>
                    {p}
                  </span>
                ) : (
                  <Link href={href(p)} className={linkIdle} aria-label={t('page', { page: p })}>
                    {p}
                  </Link>
                )}
              </li>
            ),
          )}
        </ul>
      ) : (
        <span className="px-2 text-sm text-muted-foreground" aria-current="page">
          {t('page', { page: currentPage })}
        </span>
      )}

      {hasNext ? (
        <Link href={href(currentPage + 1)} rel="next" className={linkIdle}>
          {t('next')}
          <span aria-hidden="true" className="ml-1">&rsaquo;</span>
        </Link>
      ) : (
        <span aria-disabled="true" className={linkDisabled}>
          {t('next')}
          <span aria-hidden="true" className="ml-1">&rsaquo;</span>
        </span>
      )}
    </nav>
  );
}
