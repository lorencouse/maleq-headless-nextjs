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
import { useAuthStore } from '@/lib/store/auth-store';
import { reportCheckoutClientError } from '@/lib/checkout/client-error-reporting';
import { persistCartRecoverySnapshot } from '@/lib/cart-recovery/client';
import {
  getShippingOptions,
  getShippingPrice,
  getStripeShippingRates,
  SUPPORTED_SHIPPING_COUNTRIES,
  normalizeCountryCode,
} from '@/lib/checkout/shipping-rates';
import * as gtag from '@/lib/analytics/gtag';
import { clearPendingCheckout, savePendingCheckout } from '@/lib/checkout/pending-order';

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
  const discount = useCartStore((state) => state.discount);
  const autoDiscount = useCartStore((state) => state.autoDiscount);
  const autoDiscountLabel = useCartStore((state) => state.autoDiscountLabel);
  const couponCode = useCartStore((state) => state.couponCode);
  const itemCount = useCartStore((state) => state.itemCount);
  const currency = useCartStore((state) => state.currency);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const authenticatedCustomerId = user?.id && token ? Number(user.id) : undefined;

  const onClick = useCallback(
    (event: StripeExpressCheckoutElementClickEvent) => {
      event.resolve({
        emailRequired: true,
        phoneNumberRequired: true,
        shippingAddressRequired: true,
        allowedShippingCountries: SUPPORTED_SHIPPING_COUNTRIES,
        shippingRates: getStripeShippingRates(subtotal, 'US'),
      });
    },
    [subtotal]
  );

  const onShippingAddressChange = useCallback(
    (event: StripeExpressCheckoutElementShippingAddressChangeEvent) => {
      const countryCode = normalizeCountryCode(event.address.country);

      event.resolve({
        shippingRates: getStripeShippingRates(subtotal, countryCode),
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
      let failureStage: 'intent' | 'confirm' | 'order' = 'intent';
      let currentPaymentIntentId: string | null = null;
      let orderCreateFailedAfterServerResponse = false;

      try {
        const { expressPaymentType, billingDetails, shippingAddress, shippingRate } =
          event;

        const countryCode = normalizeCountryCode(shippingAddress?.address.country);
        const shippingOptions = getShippingOptions(countryCode);

        // Determine shipping cost from the selected rate for the selected country.
        const selectedRate = shippingRate
          ? shippingOptions.find((option) => option.id === shippingRate.id)
          : shippingOptions[0];

        const shippingDollars = selectedRate
          ? getShippingPrice(selectedRate, subtotal)
          : 0;
        const totalAmount = Number(
          Math.max(0, subtotal + shippingDollars - discount - autoDiscount).toFixed(2)
        );

        // Create PaymentIntent server-side
        const intentResponse = await fetch('/api/payment/create-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            amount: totalAmount,
            ...(authenticatedCustomerId && { customerId: authenticatedCustomerId }),
            cartItems: items.map((item) => ({
              productId: item.productId,
              variationId: item.variationId,
              quantity: item.quantity,
            })),
            ...(couponCode && { couponCode }),
            shippingMethod: {
              id: selectedRate?.id || 'standard',
            },
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
          let message = `Failed to create payment (${intentResponse.status})`;
          try {
            const errorData = await intentResponse.json() as { error?: string };
            if (errorData?.error) {
              message = errorData.error;
            }
          } catch {
            // Keep fallback message.
          }
          throw new Error(message);
        }

        const { clientSecret, paymentIntentId } = await intentResponse.json();
        currentPaymentIntentId = paymentIntentId;

        if (billingDetails?.email) {
          void persistCartRecoverySnapshot({
            email: billingDetails.email,
            customerId: authenticatedCustomerId || null,
            cart: {
              items,
              subtotal,
              tax: 0,
              shipping: shippingDollars,
              discount,
              autoDiscount,
              autoDiscountLabel,
              total: totalAmount,
              itemCount,
              currency,
              couponCode: couponCode || undefined,
              updatedAt: Date.now(),
            },
            shippingMethodId: selectedRate?.id || 'standard',
            shippingMethodName: selectedRate?.name || 'Standard Shipping',
            shippingCountry: shippingAddress?.address.country || 'US',
            checkoutUrl: '/checkout',
            paymentIntentId,
          });
        }

        // Parse the name from the shipping address
        const nameParts = (shippingAddress?.name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Persist pending order data before confirmation so redirect-required
        // payment methods can complete order creation on return.
        savePendingCheckout(paymentIntentId, {
          ...(authenticatedCustomerId && { customerId: authenticatedCustomerId }),
          contact: {
            email: billingDetails?.email || '',
            phone: billingDetails?.phone || '',
          },
          shippingAddress: {
            firstName,
            lastName,
            company: '',
            address1: shippingAddress?.address.line1 || '',
            address2: shippingAddress?.address.line2 || '',
            city: shippingAddress?.address.city || '',
            state: shippingAddress?.address.state || '',
            zipCode: shippingAddress?.address.postal_code || '',
            country: shippingAddress?.address.country || 'US',
          },
          shippingMethod: {
            id: selectedRate?.id || 'standard',
            name: selectedRate?.name || 'Standard Shipping',
            price: shippingDollars,
          },
          cartItems: items.map((item) => ({
            productId: item.productId,
            variationId: item.variationId,
            quantity: item.quantity,
            name: item.name,
            sku: item.sku,
            price: item.price,
          })),
          totals: {
            subtotal,
            shipping: shippingDollars,
            tax: 0,
            discount: discount + autoDiscount,
            total: totalAmount,
          },
          ...(couponCode && { couponCode }),
          authToken: token || undefined,
          flow: 'express',
        });

        // Confirm the payment
        failureStage = 'confirm';
        const { error: confirmError } = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: {
            // Keep return URL on an existing route for redirect-required payment methods.
            return_url: `${window.location.origin}/checkout`,
          },
          redirect: 'if_required',
        });

        if (confirmError) {
          void reportCheckoutClientError({
            eventType: 'checkout_express_payment_confirmation_failed',
            message: confirmError.message || 'Express checkout payment confirmation failed',
            severity: confirmError.type === 'card_error' || confirmError.type === 'validation_error'
              ? 'warning'
              : 'error',
            paymentIntentId,
            context: {
              expressPaymentType,
              errorType: confirmError.type,
              errorCode: confirmError.code || null,
              declineCode: confirmError.decline_code || null,
            },
          });
          setError(confirmError.message || 'Payment failed');
          return;
        }

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
        const shippingMethodName = selectedRate?.name || 'Standard Shipping';
        const shippingMethodId = selectedRate?.id || 'standard';

        // Create order in WooCommerce
        failureStage = 'order';
        const orderResponse = await fetch('/api/orders/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            paymentIntentId,
            ...(authenticatedCustomerId && { customerId: authenticatedCustomerId }),
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
              discount: discount + autoDiscount,
              total: totalAmount,
            },
            ...(couponCode && { couponCode }),
          }),
        });

        if (!orderResponse.ok) {
          const errorData = await orderResponse.json();
          orderCreateFailedAfterServerResponse = true;
          throw new Error(errorData.error || 'Failed to create order');
        }

        const orderData = await orderResponse.json();

        // Track purchase for express checkout path as well.
        gtag.purchase({
          transaction_id: String(orderData.orderId),
          value: totalAmount,
          tax: 0,
          shipping: shippingDollars,
          items: items.map((item) => ({
            item_id: item.productId,
            item_name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
        });

        clearPendingCheckout(paymentIntentId);
        clearCart();
        router.push(`/order-confirmation/${orderData.orderId}?key=${orderData.orderKey}`);
      } catch (err) {
        console.error('Express checkout error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Payment failed';
        const eventType = failureStage === 'order'
          ? 'checkout_express_order_create_failed'
          : failureStage === 'confirm'
            ? 'checkout_express_payment_confirmation_exception'
            : 'checkout_express_intent_failed';
        void reportCheckoutClientError({
          eventType,
          message: errorMessage,
          severity: failureStage === 'intent' ? 'warning' : 'error',
          paymentIntentId: currentPaymentIntentId,
          notifyAdmin:
            failureStage === 'confirm' ||
            (failureStage === 'order' && !orderCreateFailedAfterServerResponse),
          adminSubject: failureStage === 'order'
            ? 'Express Checkout Order Creation Failed After Payment'
            : failureStage === 'confirm'
              ? 'Express Checkout Payment Confirmation Exception'
              : undefined,
          context: {
            flow: 'express',
          },
        });
        setError(errorMessage);
      }
    },
    [
      stripe,
      elements,
      items,
      subtotal,
      discount,
      autoDiscount,
      autoDiscountLabel,
      couponCode,
      itemCount,
      currency,
      clearCart,
      router,
      token,
      authenticatedCustomerId,
    ]
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
        <p className="mt-2 text-sm text-destructive dark:text-destructive">{error}</p>
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
  const fallbackShipping = getShippingOptions('US')[0]?.price || 0;
  const effectiveShipping = Number.isFinite(shipping) && shipping >= 0
    ? shipping
    : fallbackShipping;
  const totalCents = Math.round((subtotal + effectiveShipping) * 100);

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
