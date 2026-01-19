'use client';

import { ReactNode } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { getStripe } from '@/lib/stripe/client';

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
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#2563eb', // Blue-600
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
              border: '1px solid #2563eb',
              boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.1)',
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
