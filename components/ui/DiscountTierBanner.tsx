import { AUTO_DISCOUNT_TIERS } from '@/lib/utils/cart-helpers';

interface DiscountTierBannerProps {
  className?: string;
  variant?: 'compact' | 'full';
}

export default function DiscountTierBanner({
  className = '',
  variant = 'full',
}: DiscountTierBannerProps) {
  // Sort tiers by minSubtotal ascending for display
  const tiers = [...AUTO_DISCOUNT_TIERS].sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );
  const isCompact = variant === 'compact';

  return (
    <div
      className={`relative overflow-hidden shadow-[0_0_15px_rgba(255,57,57,0.3)] ring-1 ring-primary/30 discount-banner-shimmer mx-auto ${
        isCompact
          ? 'rounded-lg max-w-xl my-4'
          : 'rounded-xl max-w-4xl my-6'
      } ${className}`}
    >
      <div className='flex items-stretch'>
        {/* Accent sidebar with labels */}
        <div
          className={`bg-gradient-to-b from-primary to-primary-dark flex flex-col justify-center ${
            isCompact ? 'px-2.5 sm:px-3' : 'px-4 sm:px-5'
          }`}
        >
          <span
            className={`font-bold uppercase tracking-widest text-white/80 ${
              isCompact ? 'text-sm py-0.5' : 'text-base sm:text-lg py-1'
            }`}
          >
            Spend
          </span>
          <span
            className={`font-bold uppercase tracking-widest text-white ${
              isCompact ? 'text-lg py-0.5' : 'text-xl sm:text-2xl py-1'
            }`}
          >
            Save
          </span>
        </div>
        {/* Tier values */}
        <div className='flex-1 bg-gradient-to-b from-background to-muted text-foreground'>
          <div className='grid grid-cols-3 divide-x divide-foreground/10 text-center'>
            {tiers.map((tier) => (
              <span
                key={`spend-${tier.minSubtotal}`}
                className={`font-bold tabular-nums ${
                  isCompact
                    ? 'py-0.5 text-base sm:text-xl'
                    : 'py-1 text-lg sm:text-2xl'
                }`}
              >
                ${tier.minSubtotal}
              </span>
            ))}
          </div>
          <div className='border-t border-foreground/15' />
          <div className='grid grid-cols-3 divide-x divide-foreground/10 text-center'>
            {tiers.map((tier) => (
              <span
                key={`save-${tier.minSubtotal}`}
                className={`font-extrabold text-primary tabular-nums ${
                  isCompact
                    ? 'py-0.5 text-lg sm:text-2xl'
                    : 'py-1 text-xl sm:text-3xl'
                }`}
              >
                ${tier.discountAmount}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div
        className={`font-bold text-center bg-foreground text-background ${
          isCompact ? 'py-1 text-sm sm:text-base' : 'py-2 text-base sm:text-lg'
        }`}
      >
        {isCompact
          ? 'Bonus Discount Applied at Checkout'
          : 'Automatic Bonus Discount Applied at Checkout'}
      </div>
    </div>
  );
}
