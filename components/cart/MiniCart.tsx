'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  useCartStore,
  useCartSubtotal,
  useIsCartEmpty,
} from '@/lib/store/cart-store';
import { formatPrice, calculateAutoDiscount } from '@/lib/utils/cart-helpers';
import MiniCartItem from './MiniCartItem';

interface MiniCartProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MiniCart({ isOpen, onClose }: MiniCartProps) {
  const items = useCartStore((state) => state.items);
  const itemCount = useCartStore((state) => state.itemCount);
  const subtotal = useCartSubtotal();
  const isEmpty = useIsCartEmpty();
  const autoDiscount = useCartStore((state) => state.autoDiscount);
  const autoDiscountLabel = useCartStore((state) => state.autoDiscountLabel);

  // Get next tier info for upsell messaging
  const autoDiscountInfo = calculateAutoDiscount(subtotal);

  // Close on ESC key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className='fixed inset-0 bg-black/50 z-40 transition-opacity'
        onClick={onClose}
        aria-hidden='true'
      />

      {/* Slide-out Panel */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-screen sm:w-96 bg-background z-50 shadow-xl transition-transform duration-300 overflow-hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role='dialog'
        aria-modal='true'
        aria-label='Shopping Cart'
      >
        {/* Header */}
        <div className='flex items-center justify-between p-3 sm:p-4 border-b border-border'>
          <h4 className='font-semibold text-foreground'>
            Shopping Cart {itemCount > 0 && `(${itemCount})`}
          </h4>
          <button
            onClick={onClose}
            className='p-2 hover:bg-muted rounded-lg transition-colors'
            aria-label='Close cart'
          >
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
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>

        {/* Cart Content */}
        <div className='flex flex-col h-[calc(100%-56px)] sm:h-[calc(100%-64px)] overflow-hidden'>
          {isEmpty ? (
            /* Empty State */
            <div className='flex-1 flex flex-col items-center justify-center p-6 text-center'>
              <svg
                className='w-16 h-16 text-muted-foreground mb-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={1.5}
                  d='M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
                />
              </svg>
              <p className='text-muted-foreground mb-4'>Your cart is empty</p>
              <button
                onClick={onClose}
                className='text-primary hover:underline font-medium'
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <>
              {/* Cart Items */}
              <div className='flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-3 sm:space-y-4'>
                {items.map((item) => (
                  <MiniCartItem key={item.id} item={item} />
                ))}
              </div>

              {/* Footer */}
              <div className='border-t border-border p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-hidden'>
                {/* Auto-Discount Upsell */}
                {autoDiscountInfo.nextTier && (
                  <div className='p-2 bg-primary/10 rounded-lg text-xs text-primary text-center'>
                    Add {formatPrice(autoDiscountInfo.nextTier.amountNeeded)}{' '}
                    more for{' '}
                    {formatPrice(autoDiscountInfo.nextTier.discountAmount)} off!
                  </div>
                )}

                {/* Auto-Discount Applied */}
                {autoDiscount > 0 && (
                  <div className='flex items-center justify-between text-sm text-primary'>
                    <span>Auto Discount</span>
                    <span>-{formatPrice(autoDiscount)}</span>
                  </div>
                )}

                {/* Subtotal */}
                <div className='flex items-center justify-between text-base sm:text-lg font-semibold'>
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal - autoDiscount)}</span>
                </div>
                <p className='text-xs sm:text-sm text-muted-foreground'>
                  Shipping & taxes calculated at checkout
                </p>

                {/* Action Buttons */}
                <div className='space-y-2 pb-4'>
                  <Link
                    href='/cart'
                    onClick={onClose}
                    className='block w-full py-2.5 sm:py-3 px-4 text-center text-sm sm:text-base border border-border rounded-lg hover:bg-muted transition-colors font-medium'
                  >
                    View Cart
                  </Link>
                  <Link
                    href='/checkout'
                    onClick={onClose}
                    className='block w-full py-2.5 sm:py-3 px-4 text-center text-sm sm:text-base bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium'
                  >
                    Checkout
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
