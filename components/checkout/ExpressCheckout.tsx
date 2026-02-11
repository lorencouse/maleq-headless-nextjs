'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Elements,
  ExpressCheckoutElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import type {
  StripeExpressCheckoutElementClickEvent,
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementShippingAddressChangeEvent,
  StripeExpressCheckoutElementShippingRateChangeEvent,
} from '@stripe/stripe-js';
import { getStripe } from '@/lib/stripe/client';
import { useCartStore, useCartSubtotal } from '@/lib/store/cart-store';

const FREE_SHIPPING_THRESHOLD = 100;

const SHIPPING_RATES = [
  {
    id: 'standard',
    displayName: 'Standard Shipping',
    amount: 799,
    deliveryEstimate: {
      minimum: { unit: 'business_day' as const, value: 5 },
      maximum: { unit: 'business_day' as const, value: 7 },
    },
  },
  {
    id: 'express',
    displayName: 'Express Shipping',
    amount: 1499,
    deliveryEstimate: {
      minimum: { unit: 'business_day' as const, value: 2 },
      maximum: { unit: 'business_day' as const, value: 3 },
    },
  },
  {
    id: 'overnight',
    displayName: 'Overnight Shipping',
    amount: 2499,
    deliveryEstimate: {
      minimum: { unit: 'business_day' as const, value: 1 },
      maximum: { unit: 'business_day' as const, value: 1 },
    },
  },
];

function getShippingRates(subtotal: number) {
  return SHIPPING_RATES.map((rate) => {
    // Free standard shipping over threshold
    if (rate.id === 'standard' && subtotal >= FREE_SHIPPING_THRESHOLD) {
      return { ...rate, amount: 0 };
    }
    return rate;
  });
}

/**
 * Inner component that uses Stripe hooks (must be inside Elements provider)
 */
function ExpressCheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const items = useCartStore((state) => state.items);
  const subtotal = useCartSubtotal();
  const clearCart = useCartStore((state) => state.clearCart);

  const onClick = useCallback(
    (event: StripeExpressCheckoutElementClickEvent) => {
      event.resolve({
        emailRequired: true,
        phoneNumberRequired: true,
        shippingAddressRequired: true,
        allowedShippingCountries: ['US'],
        shippingRates: getShippingRates(subtotal),
      });
    },
    [subtotal]
  );

  const onShippingAddressChange = useCallback(
    (event: StripeExpressCheckoutElementShippingAddressChangeEvent) => {
      // Update shipping rates based on address (all US rates are the same for now)
      event.resolve({
        shippingRates: getShippingRates(subtotal),
      });
    },
    [subtotal]
  );

  const onShippingRateChange = useCallback(
    (event: StripeExpressCheckoutElementShippingRateChangeEvent) => {
      event.resolve();
    },
    []
  );

  const onConfirm = useCallback(
    async (event: StripeExpressCheckoutElementConfirmEvent) => {
      if (!stripe || !elements) return;

      setError(null);

      try {
        const { expressPaymentType, billingDetails, shippingAddress, shippingRate } =
          event;

        // Determine shipping cost
        const selectedRate = shippingRate
          ? SHIPPING_RATES.find((r) => r.id === shippingRate.id)
          : SHIPPING_RATES[0];
        let shippingCost = selectedRate?.amount ?? 799;
        if (selectedRate?.id === 'standard' && subtotal >= FREE_SHIPPING_THRESHOLD) {
          shippingCost = 0;
        }
        const shippingDollars = shippingCost / 100;
        const totalAmount = subtotal + shippingDollars;

        // Create PaymentIntent server-side
        const intentResponse = await fetch('/api/payment/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: totalAmount,
            customerEmail: billingDetails?.email,
            metadata: {
              customer_email: billingDetails?.email || '',
              express_payment_type: expressPaymentType,
            },
            shippingAddress: shippingAddress
              ? {
                  name: shippingAddress.name,
                  address: {
                    line1: shippingAddress.address.line1,
                    line2: shippingAddress.address.line2 || undefined,
                    city: shippingAddress.address.city,
                    state: shippingAddress.address.state,
                    postal_code: shippingAddress.address.postal_code,
                    country: shippingAddress.address.country,
                  },
                }
              : undefined,
          }),
        });

        if (!intentResponse.ok) {
          throw new Error('Failed to create payment');
        }

        const { clientSecret, paymentIntentId } = await intentResponse.json();

        // Confirm the payment
        const { error: confirmError } = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: {
            return_url: `${window.location.origin}/order-confirmation`,
          },
          redirect: 'if_required',
        });

        if (confirmError) {
          setError(confirmError.message || 'Payment failed');
          return;
        }

        // Parse the name from the shipping address
        const nameParts = (shippingAddress?.name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const shippingAddr = {
          firstName,
          lastName,
          company: '',
          address1: shippingAddress?.address.line1 || '',
          address2: shippingAddress?.address.line2 || '',
          city: shippingAddress?.address.city || '',
          state: shippingAddress?.address.state || '',
          zipCode: shippingAddress?.address.postal_code || '',
          country: shippingAddress?.address.country || 'US',
        };

        // Determine shipping method name
        const shippingMethodName = selectedRate?.displayName || 'Standard Shipping';
        const shippingMethodId = selectedRate?.id || 'standard';

        // Create order in WooCommerce
        const orderResponse = await fetch('/api/orders/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentIntentId,
            contact: {
              email: billingDetails?.email || '',
              phone: billingDetails?.phone || '',
            },
            shippingAddress: shippingAddr,
            shippingMethod: {
              id: shippingMethodId,
              name: shippingMethodName,
              price: shippingDollars,
            },
            cartItems: items.map((item) => ({
              productId: item.productId,
              variationId: item.variationId,
              quantity: item.quantity,
              name: item.name,
              sku: item.sku,
            })),
            totals: {
              subtotal,
              shipping: shippingDollars,
              tax: 0,
              discount: 0,
              total: totalAmount,
            },
          }),
        });

        if (!orderResponse.ok) {
          const errorData = await orderResponse.json();
          throw new Error(errorData.error || 'Failed to create order');
        }

        const orderData = await orderResponse.json();
        clearCart();
        router.push(`/order-confirmation/${orderData.orderId}`);
      } catch (err) {
        console.error('Express checkout error:', err);
        setError(err instanceof Error ? err.message : 'Payment failed');
      }
    },
    [stripe, elements, items, subtotal, clearCart, router]
  );

  return (
    <div>
      <ExpressCheckoutElement
        onClick={onClick}
        onConfirm={onConfirm}
        onShippingAddressChange={onShippingAddressChange}
        onShippingRateChange={onShippingRateChange}
        options={{
          buttonType: {
            applePay: 'buy',
            googlePay: 'buy',
          },
          buttonTheme: {
            applePay: 'black',
            googlePay: 'black',
          },
          layout: {
            maxColumns: 3,
            maxRows: 1,
          },
        }}
      />
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/**
 * Express Checkout wrapper
 *
 * Provides Apple Pay, Google Pay, and Link one-tap payment buttons.
 * Uses its own Stripe Elements context with deferred intent (mode: 'payment').
 * Shown at the top of checkout before the regular form.
 */
export default function ExpressCheckout() {
  const subtotal = useCartSubtotal();
  const shipping = useCartStore((state) => state.shipping);

  // Convert dollars to cents for Stripe Elements
  const totalCents = Math.round((subtotal + (shipping || 7.99)) * 100);

  if (totalCents <= 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm font-medium text-foreground mb-3">Express Checkout</p>
      <Elements
        stripe={getStripe()}
        options={{
          mode: 'payment',
          amount: totalCents,
          currency: 'usd',
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#2563eb',
              borderRadius: '8px',
            },
          },
        }}
      >
        <ExpressCheckoutForm />
      </Elements>
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-3 text-muted-foreground">or continue below</span>
        </div>
      </div>
    </div>
  );
}
