import { loadStripe, Stripe } from '@stripe/stripe-js';

/**
 * Stripe Client-Side Configuration
 *
 * Loads the Stripe.js library with the publishable key.
 * Used in client components for payment forms.
 */

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!key) {
      console.error('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable');
      return Promise.resolve(null);
    }

    stripePromise = loadStripe(key);
  }

  return stripePromise;
};
