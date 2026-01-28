'use client';

import { useState } from 'react';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';

export default function CouponInput() {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = useCartSubtotal();
  const couponCode = useCartStore((state) => state.couponCode);
  const applyCoupon = useCartStore((state) => state.applyCoupon);
  const removeCoupon = useCartStore((state) => state.removeCoupon);
  const items = useCartStore((state) => state.items);

  const handleApply = async () => {
    if (!code.trim()) {
      setError('Please enter a coupon code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const productIds = items
        .map((item) => parseInt(item.productId))
        .filter((id) => !isNaN(id));

      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          cartTotal: subtotal,
          productIds,
        }),
      });

      const result = await response.json();

      if (result.valid && result.discountAmount !== undefined) {
        applyCoupon(code.trim().toUpperCase(), result.discountAmount);
        setCode('');
        showSuccess(result.message);
      } else {
        setError(result.message);
        showError(result.message);
      }
    } catch {
      setError('Failed to validate coupon');
      showError('Failed to validate coupon');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemove = () => {
    removeCoupon();
    showSuccess('Coupon removed');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  // If coupon is already applied
  if (couponCode) {
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="text-sm font-medium text-primary">{couponCode}</span>
          </div>
          <button
            onClick={handleRemove}
            className="px-3 py-2 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter coupon code"
          className="flex-1 px-3 py-2.5 min-h-[44px] text-sm border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          disabled={isLoading}
        />
        <button
          onClick={handleApply}
          disabled={isLoading || !code.trim()}
          className="px-4 py-2.5 min-h-[44px] text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            'Apply'
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
