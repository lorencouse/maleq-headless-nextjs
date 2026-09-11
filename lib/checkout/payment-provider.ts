import type Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';

/**
 * Payment provider port.
 *
 * The recovery and reconciliation paths used to talk to Stripe directly and,
 * worse, used Stripe's PaymentIntent metadata as the store of record for the
 * cart — which meant those paths could not survive a change of processor.
 * Checkout state now lives in `maleq_payment_intent_orders`
 * (`lib/checkout/payment-records.ts`), and everything those paths still need
 * from the processor is expressed here: "did this payment succeed, for how
 * much, and where was it shipping?".
 *
 * Swapping processors for the recovery path is therefore a matter of writing
 * one more adapter below. The interactive checkout surfaces (Elements, the
 * express wallets, webhook signature verification) still call the Stripe SDK
 * directly — they are provider-shaped by nature and are a separate migration.
 */

export type ProviderPaymentStatus =
  | 'succeeded'
  | 'processing'
  | 'requires_action'
  | 'canceled'
  | 'failed'
  | 'unknown';

export interface ProviderShipping {
  name: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ProviderPayment {
  id: string;
  status: ProviderPaymentStatus;
  amountCents: number;
  currency: string;
  /** When the processor created the payment, epoch milliseconds. */
  createdAtMs: number;
  receiptEmail: string | null;
  shipping: ProviderShipping | null;
  /**
   * Provider-side mirror of our WooCommerce order ID, when the provider
   * supports arbitrary key/value on a payment. Treated as a hint only — the
   * reservation table is authoritative — because not every processor offers
   * writable metadata.
   */
  orderReference: string | null;
  /** Tag identifying payments this app created. Null if the provider drops it. */
  source: string | null;
  /**
   * Raw provider metadata, for transitional reads of PaymentIntents created
   * before checkout snapshots were written to the database. New code should
   * read the snapshot instead.
   */
  legacyMetadata: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  /** Fetch the current state of a payment straight from the processor. */
  retrievePayment(paymentId: string): Promise<ProviderPayment>;
  /**
   * Best-effort mirror of our order ID onto the payment, so the processor's
   * own dashboard is navigable. Never load-bearing: callers must tolerate a
   * provider that cannot store it.
   */
  attachOrderReference(paymentId: string, orderId: number): Promise<void>;
  /**
   * Optional secondary net for reconciliation: recent payments as the
   * processor sees them.
   *
   * Reconciliation reads its candidates from our own table. This exists only
   * to catch the narrow case where the checkout snapshot could not be written
   * at all (a database blip during `create-intent`), which leaves a real
   * payment with no local row to sweep. Providers that cannot list payments
   * simply omit it and lose only that fallback.
   */
  listRecentPayments?(sinceMs: number, limit?: number): Promise<ProviderPayment[]>;
}

const STRIPE_STATUS: Record<string, ProviderPaymentStatus> = {
  succeeded: 'succeeded',
  processing: 'processing',
  requires_action: 'requires_action',
  requires_confirmation: 'requires_action',
  requires_payment_method: 'failed',
  requires_capture: 'processing',
  canceled: 'canceled',
};

function mapStripeIntent(intent: Stripe.PaymentIntent): ProviderPayment {
  const metadata = (intent.metadata || {}) as Record<string, string>;
  const shipping = intent.shipping;

  return {
    id: intent.id,
    status: STRIPE_STATUS[intent.status] ?? 'unknown',
    amountCents: intent.amount,
    currency: intent.currency,
    createdAtMs: intent.created * 1000,
    receiptEmail: intent.receipt_email || null,
    shipping: shipping
      ? {
          name: shipping.name || null,
          phone: shipping.phone || null,
          line1: shipping.address?.line1 || null,
          line2: shipping.address?.line2 || null,
          city: shipping.address?.city || null,
          state: shipping.address?.state || null,
          postalCode: shipping.address?.postal_code || null,
          country: shipping.address?.country || null,
        }
      : null,
    orderReference: metadata.woocommerce_order_id || null,
    source: metadata.source || null,
    legacyMetadata: metadata,
  };
}

const stripeProvider: PaymentProvider = {
  name: 'stripe',

  async retrievePayment(paymentId) {
    const stripe = getStripeServer();
    return mapStripeIntent(await stripe.paymentIntents.retrieve(paymentId));
  },

  async listRecentPayments(sinceMs, limit = 100) {
    const stripe = getStripeServer();
    const result = await stripe.paymentIntents.list({
      limit: Math.max(1, Math.min(limit, 100)),
      created: { gte: Math.floor(sinceMs / 1000) },
    });
    return result.data.map(mapStripeIntent);
  },

  async attachOrderReference(paymentId, orderId) {
    const stripe = getStripeServer();
    await stripe.paymentIntents.update(paymentId, {
      metadata: { woocommerce_order_id: String(orderId) },
    });
  },
};

export function getPaymentProvider(): PaymentProvider {
  return stripeProvider;
}

/** The tag written to both the snapshot and (where supported) provider metadata. */
export const CHECKOUT_SOURCE = 'maleq-headless-checkout';
