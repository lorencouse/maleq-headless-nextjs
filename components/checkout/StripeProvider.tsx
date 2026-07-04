'use client';

import { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Elements } from '@stripe/react-stripe-js';
import { getStripe, getStripeLocale } from '@/lib/stripe/client';

interface StripeProviderProps {
  children: ReactNode;
  clientSecret?: string;
}

/**
 * Stripe Elements Provider
 *
 * Wraps checkout components with Stripe Elements context.
 * Must be used when clientSecret is available (after payment intent creation).
 */
export default function StripeProvider({ children, clientSecret }: StripeProviderProps) {
  const stripePromise = getStripe();
  const locale = useLocale();

  // If no client secret, render children without Stripe context
  // This allows the checkout to render before payment intent is created
  if (!clientSecret) {
    return <>{children}</>;
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        locale: getStripeLocale(locale),
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#E63946', // Brand primary red
            colorBackground: '#ffffff',
            colorText: '#1f2937', // Gray-800
            colorDanger: '#ef4444', // Red-500
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            spacingUnit: '4px',
            borderRadius: '8px',
          },
          rules: {
            '.Input': {
              border: '1px solid #e5e7eb',
              boxShadow: 'none',
              padding: '12px',
            },
            '.Input:focus': {
              border: '1px solid #E63946',
              boxShadow: '0 0 0 3px rgba(230, 57, 70, 0.1)',
            },
            '.Label': {
              fontWeight: '500',
              marginBottom: '4px',
            },
            '.Error': {
              fontSize: '14px',
              marginTop: '4px',
            },
          },
        },
      }}
    >
      {children}
    </Elements>
  );
}
