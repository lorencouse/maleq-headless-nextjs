import { AUTO_DISCOUNT_TIERS } from '@/lib/utils/cart-helpers';

interface DiscountTierBannerProps {
  variant?: 'compact' | 'full';
  className?: string;
}

export default function DiscountTierBanner({
  variant = 'compact',
  className = '',
}: DiscountTierBannerProps) {
  // Sort tiers by minSubtotal ascending for display
  const tiers = [...AUTO_DISCOUNT_TIERS].sort(
    (a, b) => a.minSubtotal - b.minSubtotal
  );

  if (variant === 'compact') {
    return (
      <div
        className={`border-2 border-foreground bg-background rounded-lg p-3 sm:p-4 ${className}`}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm sm:text-base font-semibold text-foreground">
          {tiers.map((tier, index) => (
            <span key={tier.minSubtotal} className="flex items-center gap-1.5">
              {index > 0 && (
                <span className="text-muted-foreground/40 hidden sm:inline">|</span>
              )}
              <span>
                Spend ${tier.minSubtotal}{' '}
                <span className="text-primary">Save ${tier.discountAmount}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border-2 border-foreground bg-background rounded-lg p-4 sm:p-6 ${className}`}
    >
      <p className="text-center text-lg font-bold text-foreground mb-4">
        Buy More, Save More
      </p>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {tiers.map((tier) => (
          <div
            key={tier.minSubtotal}
            className="text-center p-3 rounded-lg bg-muted"
          >
            <p className="text-xs sm:text-sm text-muted-foreground mb-1">
              Spend ${tier.minSubtotal}+
            </p>
            <p className="text-lg sm:text-xl font-bold text-primary">
              Save ${tier.discountAmount}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
