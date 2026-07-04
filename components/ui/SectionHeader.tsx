import Link from 'next/link';
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  /** Caps eyebrow above the title; omitted = bare red kicker bar */
  kicker?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Custom right-edge content (replaces the view-all link) */
  action?: ReactNode;
  /** Margin/spacing override; defaults to mb-6 */
  className?: string;
}

/**
 * Newsstand section opener: red kicker bar (+ optional caps eyebrow) over a
 * condensed-caps display title, with an optional tracked-caps "view all" link
 * on the right edge. Replaces the old `pl-3 border-l-4 border-primary` h2s.
 *
 * Server-safe (no hooks) — callers pass already-translated strings.
 */
export default function SectionHeader({
  title,
  kicker,
  viewAllHref,
  viewAllLabel,
  action,
  className = 'mb-6',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className='min-w-0'>
        <span className='kicker' aria-hidden={kicker ? undefined : true}>
          {kicker}
        </span>
        <h2 className='heading-plain heading-display mt-1 text-2xl sm:text-3xl lg:text-4xl text-foreground'>
          {title}
        </h2>
      </div>
      {action ??
        (viewAllHref && viewAllLabel ? (
          <Link
            href={viewAllHref}
            className='flex-shrink-0 inline-flex items-center gap-1 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-foreground hover:text-primary transition-colors'
          >
            {viewAllLabel}
            <svg
              className='w-3.5 h-3.5'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              aria-hidden='true'
            >
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.5} d='M9 5l7 7-7 7' />
            </svg>
          </Link>
        ) : null)}
    </div>
  );
}
