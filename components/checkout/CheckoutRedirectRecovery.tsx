'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCartStore } from '@/lib/store/cart-store';
import { clearPendingCheckout, getPendingCheckout } from '@/lib/checkout/pending-order';
import * as gtag from '@/lib/analytics/gtag';

type RecoveryState = 'idle' | 'processing' | 'error';

export default function CheckoutRedirectRecovery() {
  const t = useTranslations('checkout.redirect');
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
      setMessage(t('paymentNotCompleted'));
      return;
    }

    const pending = getPendingCheckout(paymentIntentId);
    if (!pending) {
      setState('error');
      setMessage(t('couldNotRecover'));
      return;
    }

    const { authToken, ...orderPayload } = pending.payload;

    setState('processing');
    setMessage(t('finalizingOrder'));

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
          throw new Error(responseData?.error || t('failedToFinalize'));
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
            : t('unableToFinalize')
        );
      }
    })();
  }, [searchParams, router, clearCart, t]);

  if (state === 'idle') {
    return null;
  }

  const isError = state === 'error';
  return (
    <div
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        isError
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-info/30 bg-info/10 text-info'
      }`}
    >
      {message}
    </div>
  );
}
