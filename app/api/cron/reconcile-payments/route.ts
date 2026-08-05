import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { getStripeServer } from '@/lib/stripe/server';
import { attemptRecoveryOrderCreation } from '@/lib/checkout/payment-recovery';
import { lookupPaymentIntentReservation } from '@/lib/checkout/payment-intent-lock';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import { sendAdminAlert } from '@/lib/email/alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Payment reconciliation cron.
 *
 * The Stripe webhook deliberately stands down whenever checkout might still be
 * creating the order — that guard is what stopped the duplicate-order pairs,
 * but it also means a checkout that genuinely dies mid-flight no longer gets
 * recovered inline. This sweep is the backstop: it looks for succeeded
 * PaymentIntents from our checkout that are old enough that no in-flight
 * request could still be responsible, and have no WooCommerce order.
 *
 * Suggested schedule: every 15 minutes.
 *   *\/15 * * * * curl -s -H "x-api-key: $ADMIN_API_KEY" \
 *     http://localhost:3000/api/cron/reconcile-payments
 */

/** Old enough that no in-flight checkout request could still own the payment. */
const MIN_AGE_MS = 10 * 60 * 1000;

/** Ignore anything older than this — stale failures need a human, not a bot. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const authError = verifyCronOrAdminAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    const stripe = getStripeServer();
    const now = Date.now();

    const intents = await stripe.paymentIntents.list({
      limit: 100,
      created: { gte: Math.floor((now - MAX_AGE_MS) / 1000) },
    });

    const checked: string[] = [];
    const recovered: string[] = [];
    const skipped: string[] = [];

    for (const intent of intents.data) {
      if (intent.status !== 'succeeded') continue;
      if (intent.metadata?.source !== 'maleq-headless-checkout') continue;
      if (now - intent.created * 1000 < MIN_AGE_MS) continue;
      if (intent.metadata?.woocommerce_order_id) continue;

      checked.push(intent.id);

      // The reservation table is the authoritative record of what checkout did.
      const reservation = await lookupPaymentIntentReservation(intent.id);
      if (reservation?.orderId) {
        skipped.push(intent.id);
        continue;
      }
      if (reservation && reservation.status === 'processing') {
        // A row with no order ID this long after payment means checkout died
        // between taking the lock and creating the order. Nothing can release
        // it now, so surface it rather than silently leaving the payment
        // unfulfilled — clearing the row is a deliberate human decision.
        await logDurableEvent({
          eventType: 'payment_reconcile_stuck_reservation',
          severity: 'warning',
          message: 'Payment intent reservation stuck in processing with no order',
          paymentIntentId: intent.id,
          payload: { amount: intent.amount, ageMinutes: Math.round((now - intent.created * 1000) / 60000) },
        });
        await sendAdminAlert('Stuck Checkout Reservation', {
          'PaymentIntent': intent.id,
          'Amount': `$${(intent.amount / 100).toFixed(2)}`,
          'Customer Email': intent.receipt_email || 'N/A',
          'Action':
            'Confirm no WooCommerce order exists, then delete the row from maleq_payment_intent_orders to let recovery run.',
        });
        skipped.push(intent.id);
        continue;
      }

      // No order, no reservation — checkout never got off the ground.
      // skipGrace: this payment has been unmatched for at least MIN_AGE_MS.
      await attemptRecoveryOrderCreation(intent, { skipGrace: true });
      recovered.push(intent.id);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      duration: `${duration}s`,
      scanned: intents.data.length,
      unmatched: checked.length,
      recoveryAttempted: recovered,
      skipped,
    });
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error('[Cron] Payment reconciliation failed:', error);

    return NextResponse.json(
      {
        success: false,
        duration: `${duration}s`,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
