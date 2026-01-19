import Stripe from 'stripe';

/**
 * Stripe Server-Side Configuration
 *
 * Creates a Stripe instance with the secret key.
 * Used in API routes for server-side operations.
 */

let stripeInstance: Stripe | null = null;

export function getStripeServer(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('Missing STRIPE_SECRET_KEY environment variable');
    }
    stripeInstance = new Stripe(key, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

/**
 * Format amount for Stripe (converts dollars to cents)
 */
export function formatAmountForStripe(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Format amount from Stripe (converts cents to dollars)
 */
export function formatAmountFromStripe(amount: number): number {
  return amount / 100;
}
