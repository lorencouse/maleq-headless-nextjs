'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

// Adults-only retail: the buyer attests to 18+ before ANY payment path can run.
// Shared state, because the checkout page offers two of them — the express wallet
// buttons (Apple Pay / Google Pay / Link) and the card form — and a gate on only
// one of them is not a gate.
interface AgeGateValue {
  ageConfirmed: boolean;
  setAgeConfirmed: (confirmed: boolean) => void;
}

const AgeGateContext = createContext<AgeGateValue | null>(null);

export function AgeGateProvider({ children }: { children: ReactNode }) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const value = useMemo(() => ({ ageConfirmed, setAgeConfirmed }), [ageConfirmed]);

  return <AgeGateContext.Provider value={value}>{children}</AgeGateContext.Provider>;
}

export function useAgeGate(): AgeGateValue {
  const context = useContext(AgeGateContext);
  if (!context) {
    throw new Error('useAgeGate must be used within an AgeGateProvider');
  }
  return context;
}

/**
 * The attestation checkbox. Rendered once above the express wallet buttons and
 * again above the card submit button — both bound to the same state, so ticking
 * either one satisfies both paths.
 */
export function AgeConfirmCheckbox({ id }: { id: string }) {
  const t = useTranslations('checkout.payment');
  const { ageConfirmed, setAgeConfirmed } = useAgeGate();

  return (
    <div className="flex items-start gap-3 p-3 border border-input rounded-lg bg-background">
      <input
        id={id}
        type="checkbox"
        checked={ageConfirmed}
        onChange={(e) => setAgeConfirmed(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
      />
      <label htmlFor={id} className="text-sm text-muted-foreground cursor-pointer">
        {t('ageConfirm')}
      </label>
    </div>
  );
}
