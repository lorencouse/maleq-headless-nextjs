import Link from 'next/link';
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  /** Caps eyebrow above the title; omitted = bare red kicker bar */
  kicker?: string;
  /** Deck line under the title — stays attached to the heading (no rule between) */
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Custom right-edge content (replaces the view-all link) */
  action?: ReactNode;
  /** Center the whole block — for standalone CTA "moments" (newsletter, social) */
  centered?: boolean;
  /** Margin/spacing override; defaults to mb-6 */
  className?: string;
}

/**
 * Newsstand section opener: red kicker bar (+ optional caps eyebrow) over a
 * condensed-caps display title, an optional attached deck, and an optional
 * tracked-caps "view all" link on the right edge. This is the ONE canonical
 * section header — it replaces both the old `pl-3 border-l-4` h2s and the bare
 * `<h2>` blocks that picked up the full-width thick rule inconsistently.
 *
 * Server-safe (no hooks) — callers pass already-translated strings.
 */
export default function SectionHeader({
  title,
  kicker,
  subtitle,
  viewAllHref,
  viewAllLabel,
  action,
  centered = false,
  className = 'mb-6',
}: SectionHeaderProps) {
  const heading = (
    <div className='min-w-0'>
      <span
        className={`kicker ${centered ? 'justify-center' : ''}`}
        aria-hidden={kicker ? undefined : true}
      >
        {kicker}
      </span>
      <h2 className='heading-plain heading-display mt-1 text-2xl sm:text-3xl lg:text-4xl text-foreground'>
        {title}
      </h2>
      {subtitle && (
        <p className='mt-2 text-sm sm:text-base text-muted-foreground'>{subtitle}</p>
      )}
    </div>
  );

  if (centered) {
    return <div className={`flex flex-col items-center text-center ${className}`}>{heading}</div>;
  }

  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      {heading}
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
