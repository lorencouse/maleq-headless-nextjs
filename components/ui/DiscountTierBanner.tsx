import { AUTO_DISCOUNT_TIERS } from '@/lib/utils/cart-helpers';

interface DiscountTierBannerProps {
  className?: string;
  variant?: 'compact' | 'full';
}

export default function DiscountTierBanner({
  className = '',
}: DiscountTierBannerProps) {
  // Sort tiers by minSubtotal ascending for display
  const tiers = [...AUTO_DISCOUNT_TIERS].sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );

  return (
    <div className='relative rounded-lg overflow-hidden shadow-[0_0_15px_rgba(255,57,57,0.3)] ring-1 ring-primary/30 discount-banner-shimmer max-w-xl mx-auto my-4'>
      <div className='flex items-stretch'>
        {/* Accent sidebar with labels */}
        <div className='bg-gradient-to-b from-primary to-primary-dark flex flex-col justify-center px-2.5 sm:px-3'>
          <span className='text-sm font-bold uppercase tracking-widest text-white/80 py-0.5'>
            Spend
          </span>
          <span className='text-lg font-bold uppercase tracking-widest text-white py-0.5'>
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
      <div className='font-bold text-center py-1 bg-foreground text-background '>
        Bonus Discount Applied at Checkout
      </div>
    </div>
  );
}
