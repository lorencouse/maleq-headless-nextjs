import { loadStripe, Stripe, StripeElementLocale } from '@stripe/stripe-js';

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

// App locale → Stripe Elements locale. Stripe ships its own translations for
// the payment UI (field labels, validation errors, wallet sheets); we just
// tell it which one to use. Simplified Chinese is `zh`; our Traditional locale
// maps to `zh-TW` (Stripe's Taiwan variant, matching our Traditional content).
const STRIPE_LOCALE: Record<string, StripeElementLocale> = {
  en: 'en',
  es: 'es',
  zh: 'zh',
  'zh-hant': 'zh-TW',
  ja: 'ja',
};

/**
 * Map an app locale to a Stripe Elements locale so the payment form renders in
 * the user's language. Unknown locales fall back to 'auto' (Stripe detects
 * from the browser).
 */
export function getStripeLocale(locale: string): StripeElementLocale {
  return STRIPE_LOCALE[locale] ?? 'auto';
}
