'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsCartEmpty } from '@/lib/store/cart-store';
import CheckoutLayout from '@/components/checkout/CheckoutLayout';
import OrderSummary from '@/components/checkout/OrderSummary';
import CheckoutProgress from '@/components/checkout/CheckoutProgress';
import CheckoutForm from '@/components/checkout/CheckoutForm';
import ExpressCheckout from '@/components/checkout/ExpressCheckout';

export default function CheckoutPage() {
  const router = useRouter();
  const isEmpty = useIsCartEmpty();
  const [checkoutStep, setCheckoutStep] = useState<'information' | 'shipping' | 'payment'>('information');
  const handleStepChange = useCallback((step: 'information' | 'shipping' | 'payment') => {
    setCheckoutStep(step);
  }, []);

  // Redirect to cart if empty
  useEffect(() => {
    if (isEmpty) {
      router.push('/cart');
    }
  }, [isEmpty, router]);

  // Show loading while checking cart
  if (isEmpty) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Checkout</h1>
        <p className="text-muted-foreground mt-1">
          Complete your order securely
        </p>
      </div>

      {/* Express Checkout (Apple Pay, Google Pay, Link) */}
      <div className="mb-6">
        <ExpressCheckout />
      </div>

      {/* Progress Indicator */}
      <CheckoutProgress currentStep={checkoutStep} />

      {/* Checkout Content */}
      <CheckoutLayout
        formSection={<CheckoutForm onStepChange={handleStepChange} />}
        summarySection={<OrderSummary />}
      />

      {/* Security Badges */}
      <div className="mt-8 pt-6 border-t border-border">
        <div className="flex flex-wrap items-center justify-center gap-6 text-muted-foreground">
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>SSL Encrypted</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Secure Checkout</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span>Safe Payment</span>
          </div>
        </div>
      </div>
    </div>
  );
}
