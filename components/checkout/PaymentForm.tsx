'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { savePendingCheckout, type PendingOrderPayload } from '@/lib/checkout/pending-order';
import { reportCheckoutClientError } from '@/lib/checkout/client-error-reporting';
import Button from '@/components/ui/Button';

interface PaymentFormProps {
  paymentIntentId?: string | null;
  pendingOrderPayload?: PendingOrderPayload;
  onSuccess: (paymentIntentId: string) => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

export default function PaymentForm({
  paymentIntentId,
  pendingOrderPayload,
  onSuccess,
  onError,
  isProcessing,
  setIsProcessing,
}: PaymentFormProps) {
  const t = useTranslations('checkout.payment');
  const stripe = useStripe();
  const elements = useElements();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // Persist pending order data before payment confirmation so redirect-based
      // payment methods can recover and complete order creation on return.
      if (paymentIntentId && pendingOrderPayload) {
        savePendingCheckout(paymentIntentId, pendingOrderPayload);
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // Keep return URL on an existing route for redirect-required payment methods.
          return_url: `${window.location.origin}/checkout`,
        },
        redirect: 'if_required',
      });

      if (error) {
        void reportCheckoutClientError({
          eventType: 'checkout_client_payment_confirmation_failed',
          message: error.message || 'Stripe payment confirmation failed',
          severity: error.type === 'card_error' || error.type === 'validation_error'
            ? 'warning'
            : 'error',
          paymentIntentId: paymentIntentId || null,
          context: {
            errorType: error.type,
            errorCode: error.code || null,
            declineCode: error.decline_code || null,
          },
        });
        // Show error to customer
        if (error.type === 'card_error' || error.type === 'validation_error') {
          setErrorMessage(error.message || t('errorPaymentGeneric'));
        } else {
          setErrorMessage(t('errorUnexpected'));
        }
        setIsProcessing(false);
        onError(error.message || t('errorPaymentFailed'));
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded - keep isProcessing true so CheckoutForm's
        // overlay stays visible during order creation
        onSuccess(paymentIntent.id);
      } else if (paymentIntent && paymentIntent.status === 'requires_action') {
        // Handle 3D Secure or other actions
        // The redirect: 'if_required' should handle this automatically
        setIsProcessing(false);
        setErrorMessage(t('errorAdditionalAuth'));
      }
    } catch (err) {
      console.error('Payment error:', err);
      void reportCheckoutClientError({
        eventType: 'checkout_client_payment_confirmation_exception',
        message: err instanceof Error ? err.message : 'Unexpected payment confirmation error',
        severity: 'error',
        paymentIntentId: paymentIntentId || null,
        notifyAdmin: true,
        adminSubject: 'Checkout Payment Confirmation Exception',
      });
      setErrorMessage(t('errorUnexpected'));
      setIsProcessing(false);
      onError(t('errorProcessing'));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-3">
          {t('cardDetails')}
        </label>
        <div className="p-4 border border-input rounded-lg bg-background">
          <PaymentElement
            options={{
              layout: 'tabs',
            }}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive dark:text-destructive">{errorMessage}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || isProcessing}
        size="lg"
        className="w-full"
      >
        {isProcessing ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {t('processing')}
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {t('completeOrder')}
          </>
        )}
      </Button>

      {/* Security Notice */}
      <p className="text-xs text-center text-muted-foreground">
        {t('sslNotice')}
      </p>
    </form>
  );
}
