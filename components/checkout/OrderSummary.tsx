'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  useCartStore,
  useCartSubtotal,
  useCartTotal,
} from '@/lib/store/cart-store';
import { formatPrice, getFreeShippingProgress } from '@/lib/utils/cart-helpers';
import DiscountTierBanner from '@/components/ui/DiscountTierBanner';

const FREE_SHIPPING_THRESHOLD = 100;

export default function OrderSummary() {
  const items = useCartStore((state) => state.items);
  const subtotal = useCartSubtotal();
  const total = useCartTotal();
  const shipping = useCartStore((state) => state.shipping);
  const tax = useCartStore((state) => state.tax);
  const discount = useCartStore((state) => state.discount);
  const couponCode = useCartStore((state) => state.couponCode);

  const freeShipping = getFreeShippingProgress(
    subtotal,
    FREE_SHIPPING_THRESHOLD,
  );

  return (
    <div className='bg-muted/30 rounded-lg border border-border sticky top-24'>
      {/* Header */}
      <div className='p-4 border-b border-border flex items-center justify-between'>
        <h2 className='text-lg font-semibold text-foreground'>Order Summary</h2>
        <Link
          href='/cart'
          className='text-sm text-primary hover:text-primary-hover'
        >
          Edit Cart
        </Link>
      </div>

      {/* Discount Tiers */}
      <div className='px-4 py-4'>
        <DiscountTierBanner variant='compact' />
      </div>

      {/* Items List */}
      <div className='p-4 max-h-80 overflow-y-auto'>
        <ul className='space-y-4'>
          {items.map((item) => (
            <li key={item.id} className='flex gap-3'>
              {/* Product Image */}
              <div className='relative w-16 h-16 flex-shrink-0 bg-muted rounded-md overflow-hidden'>
                {item.image ? (
                  <Image
                    src={item.image.url}
                    alt={item.image.altText || item.name}
                    fill
                    sizes='64px'
                    className='object-cover'
                  />
                ) : (
                  <div className='w-full h-full flex items-center justify-center text-muted-foreground'>
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* Product Details */}
              <div className='flex-1 min-w-0'>
                <Link
                  href={`/product/${item.slug}`}
                  className='text-sm font-medium text-foreground hover:text-primary truncate block'
                >
                  {item.name}
                </Link>
                {item.attributes && Object.keys(item.attributes).length > 0 && (
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    {Object.entries(item.attributes)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(', ')}
                  </p>
                )}
                <p className='text-sm text-foreground mt-1'>
                  {formatPrice(item.price)}{' '}
                  <span className='text-muted-foreground'>
                    x{item.quantity}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Summary */}
      <div className='p-4 border-t border-border space-y-3'>
        {/* Free Shipping Progress */}
        {!freeShipping.qualifies && (
          <div className='p-3 bg-background rounded-lg'>
            <div className='flex items-center justify-between text-xs mb-2'>
              <span className='text-muted-foreground'>
                Free shipping progress
              </span>
              <span className='font-medium text-primary'>
                {formatPrice(freeShipping.remaining)} away
              </span>
            </div>
            <div className='w-full bg-muted rounded-full h-1.5'>
              <div
                className='bg-primary h-1.5 rounded-full transition-all duration-300'
                style={{ width: `${freeShipping.percentage}%` }}
              />
            </div>
          </div>
        )}

        {freeShipping.qualifies && (
          <div className='p-2 font-semibold text-success bg-success/10 rounded-lg text-sm flex items-center gap-2'>
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
                d='M5 13l4 4L19 7'
              />
            </svg>
            Free shipping applied!
          </div>
        )}

        {/* Line Items */}
        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>Subtotal</span>
          <span className='text-foreground'>{formatPrice(subtotal)}</span>
        </div>

        {discount > 0 && couponCode && (
          <div className='flex justify-between text-sm'>
            <span className='text-primary'>Discount ({couponCode})</span>
            <span className='text-primary'>-{formatPrice(discount)}</span>
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
              <span className='text-muted-foreground'>
                Calculated next step
              </span>
            )}
          </span>
        </div>

        <div className='flex justify-between text-sm'>
          <span className='text-muted-foreground'>Tax</span>
          <span className='text-foreground'>
            {tax > 0 ? (
              formatPrice(tax)
            ) : (
              <span className='text-muted-foreground'>
                Calculated next step
              </span>
            )}
          </span>
        </div>

        {/* Total */}
        <div className='pt-3 border-t border-border flex justify-between items-center'>
          <span className='text-base font-semibold text-foreground'>Total</span>
          <span className='text-xl font-bold text-foreground'>
            {formatPrice(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
