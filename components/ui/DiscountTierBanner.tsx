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
    (a, b) => a.minSubtotal - b.minSubtotal,
  );

  if (variant === 'compact') {
    return (
      <div
        className={`relative rounded-lg overflow-hidden shadow-[0_0_15px_rgba(255,57,57,0.3)] ring-1 ring-primary/30 discount-banner-shimmer ${className}`}
      >
        <div className='flex items-stretch'>
          {/* Accent sidebar with labels */}
          <div className='bg-gradient-to-b from-primary to-primary-dark flex flex-col justify-center px-2.5 sm:px-3'>
            <span className='text-sm sm:text-base font-bold uppercase tracking-widest text-white/80 py-0.5'>
              Spend
            </span>
            <span className='text-sm sm:text-base font-bold uppercase tracking-widest text-white py-0.5'>
              Save
            </span>
          </div>
          {/* Tier values */}
          <div className='flex-1 bg-gradient-to-b from-background to-muted text-foreground'>
            <div className='grid grid-cols-3 divide-x divide-foreground/10 text-center'>
              {tiers.map((tier) => (
                <span
                  key={`spend-${tier.minSubtotal}`}
                  className='py-0.5 text-base sm:text-xl font-bold tabular-nums'
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
                  className='py-0.5 text-lg sm:text-2xl font-extrabold text-primary tabular-nums'
                >
                  ${tier.discountAmount}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border-2 border-foreground bg-background rounded-lg p-4 sm:p-6 ${className}`}
    >
      <p className='text-center text-lg font-bold text-foreground mb-4'>
        Buy More, Save More
      </p>
      <div className='grid grid-cols-3 gap-3 sm:gap-4'>
        {tiers.map((tier) => (
          <div
            key={tier.minSubtotal}
            className='text-center p-3 rounded-lg bg-muted'
          >
            <p className='text-xs sm:text-sm text-muted-foreground mb-1'>
              Spend ${tier.minSubtotal}+
            </p>
            <p className='text-lg sm:text-xl font-bold text-primary'>
              Save ${tier.discountAmount}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
