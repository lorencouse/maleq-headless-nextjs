'use client';

import { ReactNode, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';
import { formatPrice } from '@/lib/utils/cart-helpers';

interface CheckoutLayoutProps {
  formSection: ReactNode;
  summarySection: ReactNode;
}

export default function CheckoutLayout({ formSection, summarySection }: CheckoutLayoutProps) {
  const t = useTranslations('checkout.mobileSummary');
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const items = useCartStore((state) => state.items);
  const subtotal = useCartSubtotal();
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-8">
      {/* Mobile Order Summary Toggle - only visible below lg */}
      <div className="lg:hidden mb-6">
        <button
          onClick={() => setMobileOrderOpen(!mobileOrderOpen)}
          className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-lg"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            <span className="font-medium text-foreground">
              {mobileOrderOpen ? t('hide') : t('show')}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('itemCount', { count: itemCount })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground">{formatPrice(subtotal)}</span>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform ${mobileOrderOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Collapsible summary content */}
        {mobileOrderOpen && (
          <div className="mt-2 border border-border rounded-lg overflow-hidden">
            {summarySection}
          </div>
        )}
      </div>

      {/* Form Section - Left side */}
      <div className="lg:col-span-7 xl:col-span-8">
        {formSection}
      </div>

      {/* Summary Section - Right side (desktop only) */}
      <div className="hidden lg:block lg:col-span-5 xl:col-span-4">
        {summarySection}
      </div>
    </div>
  );
}
