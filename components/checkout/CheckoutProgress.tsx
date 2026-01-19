'use client';

type CheckoutStep = 'information' | 'shipping' | 'payment';

interface CheckoutProgressProps {
  currentStep: CheckoutStep;
}

const steps = [
  { id: 'information' as const, name: 'Information', description: 'Contact & Address' },
  { id: 'shipping' as const, name: 'Shipping', description: 'Delivery Method' },
  { id: 'payment' as const, name: 'Payment', description: 'Complete Order' },
];

export default function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <nav aria-label="Checkout progress" className="mb-8">
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
                    {step.name}
                  </p>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    {step.description}
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
