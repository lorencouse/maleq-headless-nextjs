'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCartStore } from '@/lib/store/cart-store';
import { clearPendingCheckout, getPendingCheckout } from '@/lib/checkout/pending-order';
import * as gtag from '@/lib/analytics/gtag';

type RecoveryState = 'idle' | 'processing' | 'error';

export default function CheckoutRedirectRecovery() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clearCart = useCartStore((state) => state.clearCart);

  const handledPaymentIntentRef = useRef<string | null>(null);
  const [state, setState] = useState<RecoveryState>('idle');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const paymentIntentId = searchParams.get('payment_intent');
    const redirectStatus = searchParams.get('redirect_status');

    if (!paymentIntentId) return;
    if (handledPaymentIntentRef.current === paymentIntentId) return;
    handledPaymentIntentRef.current = paymentIntentId;

    if (redirectStatus && redirectStatus !== 'succeeded') {
      setState('error');
      setMessage('Payment was not completed. Please try again with another payment method.');
      return;
    }

    const pending = getPendingCheckout(paymentIntentId);
    if (!pending) {
      setState('error');
      setMessage('We could not recover your pending checkout. Please contact support if you were charged.');
      return;
    }

    const { authToken, ...orderPayload } = pending.payload;

    setState('processing');
    setMessage('Finalizing your order...');

    void (async () => {
      try {
        const response = await fetch('/api/orders/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            paymentIntentId,
            ...orderPayload,
          }),
        });

        const responseData = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(responseData?.error || 'Failed to finalize order');
        }

        // Emit purchase event for redirect-based payment methods where the
        // original client flow never reached the order creation code path.
        gtag.purchase({
          transaction_id: String(responseData.orderId),
          value: pending.payload.totals.total,
          tax: pending.payload.totals.tax,
          shipping: pending.payload.totals.shipping,
          items: pending.payload.cartItems.map((item) => ({
            item_id: item.productId,
            item_name: item.name,
            price: item.price || 0,
            quantity: item.quantity,
          })),
        });

        clearPendingCheckout(paymentIntentId);
        clearCart();
        router.replace(`/order-confirmation/${responseData.orderId}?key=${responseData.orderKey}`);
      } catch (error) {
        console.error('Checkout redirect recovery failed:', error);
        setState('error');
        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to finalize your order automatically. Please contact support if payment was captured.'
        );
      }
    })();
  }, [searchParams, router, clearCart]);

  if (state === 'idle') {
    return null;
  }

  const isError = state === 'error';
  return (
    <div
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        isError
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-blue-300 bg-blue-50 text-blue-700'
      }`}
    >
      {message}
    </div>
  );
}
