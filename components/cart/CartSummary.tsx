'use client';

import Link from 'next/link';
import {
  useCartStore,
  useCartSubtotal,
  useCartTotal,
} from '@/lib/store/cart-store';
import {
  formatPrice,
  getFreeShippingProgress,
  calculateAutoDiscount,
} from '@/lib/utils/cart-helpers';
import CouponInput from './CouponInput';
import DiscountTierBanner from '@/components/ui/DiscountTierBanner';

const FREE_SHIPPING_THRESHOLD = 100;

export default function CartSummary() {
  const subtotal = useCartSubtotal();
  const total = useCartTotal();
  const shipping = useCartStore((state) => state.shipping);
  const tax = useCartStore((state) => state.tax);
  const discount = useCartStore((state) => state.discount);
  const couponCode = useCartStore((state) => state.couponCode);
  const itemCount = useCartStore((state) => state.itemCount);
  const autoDiscount = useCartStore((state) => state.autoDiscount);
  const autoDiscountLabel = useCartStore((state) => state.autoDiscountLabel);

  // Get next tier info for upsell messaging
  const autoDiscountInfo = calculateAutoDiscount(subtotal);

  const freeShipping = getFreeShippingProgress(
    subtotal,
    FREE_SHIPPING_THRESHOLD,
  );

  return (
    <div className='bg-muted/30 rounded-lg p-6 border border-border sticky top-24'>
      <h2 className='text-xl font-semibold text-foreground mb-4'>
        Order Summary
      </h2>

      {/* Discount Tiers */}
      <DiscountTierBanner variant='compact' className='my-4' />

      {/* Free Shipping Progress */}
      {!freeShipping.qualifies && (
        <div className='mb-4 p-3 bg-background rounded-lg'>
          <div className='flex items-center justify-between text-sm mb-2'>
            <span className='text-muted-foreground'>
              Free shipping progress
            </span>
            <span className='font-medium text-primary'>
              {formatPrice(freeShipping.remaining)} away
            </span>
          </div>
          <div className='w-full bg-muted rounded-full h-2'>
            <div
              className='bg-primary h-2 rounded-full transition-all duration-300'
              style={{ width: `${freeShipping.percentage}%` }}
            />
          </div>
        </div>
      )}

      {freeShipping.qualifies && (
        <div className='mb-4 p-3 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 rounded-lg text-sm flex items-center gap-2'>
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M5 13l4 4L19 7'
            />
          </svg>
          You qualify for free shipping!
        </div>
      )}

      {/* Auto-Discount Applied Banner */}
      {autoDiscount > 0 && (
        <div className='mb-4 p-3 bg-primary/10 text-primary rounded-lg text-sm flex items-center gap-2'>
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
            />
          </svg>
          <span className='font-medium'>{autoDiscountLabel}</span>
        </div>
      )}

      {/* Next Discount Tier Progress */}
      {autoDiscountInfo.nextTier && (
        <div className='mb-4 p-3 bg-background rounded-lg'>
          <div className='flex items-center justify-between text-sm mb-2'>
            <span className='text-muted-foreground'>Save more</span>
            <span className='font-medium text-primary'>
              Add {formatPrice(autoDiscountInfo.nextTier.amountNeeded)} for{' '}
              {formatPrice(autoDiscountInfo.nextTier.discountAmount)} off
            </span>
          </div>
        </div>
      )}

      {/* Coupon Input */}
      <CouponInput />

      {/* Summary Lines */}
      <div className='space-y-3 mb-4'>
        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>
            Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})
          </span>
          <span className='text-foreground'>{formatPrice(subtotal)}</span>
        </div>

        {discount > 0 && couponCode && (
          <div className='flex justify-between text-sm'>
            <span className='text-primary'>Coupon ({couponCode})</span>
            <span className='text-primary'>-{formatPrice(discount)}</span>
          </div>
        )}

        {autoDiscount > 0 && (
          <div className='flex justify-between text-sm'>
            <span className='text-primary'>Auto Discount</span>
            <span className='text-primary'>-{formatPrice(autoDiscount)}</span>
          </div>
        )}

        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>Shipping</span>
          <span className='text-foreground'>
            {freeShipping.qualifies ? (
              <span className='text-primary'>FREE</span>
            ) : shipping > 0 ? (
              formatPrice(shipping)
            ) : (
              'Calculated at checkout'
            )}
          </span>
        </div>

        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>Tax</span>
          <span className='text-foreground'>
            {tax > 0 ? formatPrice(tax) : 'Calculated at checkout'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className='border-t border-border my-4' />

      {/* Total */}
      <div className='flex justify-between items-center mb-6'>
        <span className='text-lg font-semibold text-foreground'>
          Estimated Total
        </span>
        <span className='text-2xl font-bold text-foreground'>
          {formatPrice(total)}
        </span>
      </div>

      {/* Checkout Button */}
      <Link
        href='/checkout'
        className='block w-full py-3 px-4 text-center bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold text-lg'
      >
        Proceed to Checkout
      </Link>

      {/* Continue Shopping */}
      <Link
        href='/shop'
        className='block w-full py-3 px-4 text-center text-muted-foreground hover:text-foreground transition-colors mt-3'
      >
        Continue Shopping
      </Link>

      {/* Trust Badges */}
      <div className='mt-6 pt-4 border-t border-border'>
        <div className='flex items-center justify-center gap-4 text-muted-foreground'>
          <div className='flex items-center gap-1 text-xs'>
            <svg
              className='w-4 h-4'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
              />
            </svg>
            Secure Checkout
          </div>
          <div className='flex items-center gap-1 text-xs'>
            <svg
              className='w-4 h-4'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
              />
            </svg>
            Safe Payment
          </div>
        </div>
      </div>
    </div>
  );
}
