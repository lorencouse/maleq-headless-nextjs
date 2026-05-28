'use client';

import { useTranslations } from 'next-intl';

type CheckoutStep = 'information' | 'shipping' | 'payment';

interface CheckoutProgressProps {
  currentStep: CheckoutStep;
}

// Steps store translation key fragments rather than display strings; labels
// are resolved at render time. The order here dictates the visual sequence
// and the "complete vs upcoming" calculation.
const steps = [
  { id: 'information' as const, nameKey: 'informationName' as const, descKey: 'informationDesc' as const },
  { id: 'shipping' as const, nameKey: 'shippingName' as const, descKey: 'shippingDesc' as const },
  { id: 'payment' as const, nameKey: 'paymentName' as const, descKey: 'paymentDesc' as const },
];

export default function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  const t = useTranslations('checkout.progress');
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <nav aria-label={t('ariaLabel')} className="mb-8">
      <ol className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isUpcoming = index > currentIndex;

          return (
            <li key={step.id} className="flex-1 relative">
              {/* Connector Line */}
              {index > 0 && (
                <div
                  className={`absolute left-0 top-4 h-0.5 w-full -translate-x-1/2 ${
                    isCompleted ? 'bg-primary' : 'bg-border'
                  }`}
                  aria-hidden="true"
                />
              )}

              <div className="relative flex flex-col items-center">
                {/* Step Circle */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium z-10 ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isCurrent
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>

                {/* Step Label */}
                <div className="mt-2 text-center">
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? 'text-foreground' : isCompleted ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {t(step.nameKey)}
                  </p>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    {t(step.descKey)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
