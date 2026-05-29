'use client';

import type { UnitSystem } from '@/lib/products/size-units';

interface UnitSystemToggleProps {
  system: UnitSystem;
  onChange: (s: UnitSystem) => void;
  /** Hint at what's being converted, e.g. 'in / cm' or 'oz / ml'. */
  imperialLabel?: string;
  metricLabel?: string;
}

/**
 * Compact segmented control to flip size labels between imperial and metric.
 * Self-contained (no i18n keys) since unit abbreviations are universal.
 */
export default function UnitSystemToggle({
  system,
  onChange,
  imperialLabel = 'in / oz',
  metricLabel = 'cm / ml',
}: UnitSystemToggleProps) {
  const base =
    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors min-h-[32px]';
  return (
    <div
      className='inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5'
      role='group'
      aria-label='Unit system'
    >
      <button
        type='button'
        onClick={() => onChange('imperial')}
        aria-pressed={system === 'imperial'}
        className={`${base} ${
          system === 'imperial'
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {imperialLabel}
      </button>
      <button
        type='button'
        onClick={() => onChange('metric')}
        aria-pressed={system === 'metric'}
        className={`${base} ${
          system === 'metric'
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {metricLabel}
      </button>
    </div>
  );
}
