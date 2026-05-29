'use client';

import { useTranslations } from 'next-intl';
import type { UnitSystem } from '@/lib/products/size-units';

interface UnitSystemToggleProps {
  system: UnitSystem;
  onChange: (s: UnitSystem) => void;
}

/**
 * Compact segmented control to flip size labels between imperial and metric.
 * Labels are localized unit abbreviations (productRelated.unitToggle*); the
 * metric side stays cm/ml (universal) while the imperial side localizes.
 */
export default function UnitSystemToggle({ system, onChange }: UnitSystemToggleProps) {
  const t = useTranslations('productRelated');
  const base =
    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors min-h-[32px]';
  return (
    <div
      className='inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5'
      role='group'
      aria-label={t('unitToggleAria')}
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
        {t('unitToggleImperial')}
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
        {t('unitToggleMetric')}
      </button>
    </div>
  );
}
