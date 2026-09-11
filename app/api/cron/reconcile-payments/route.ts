import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdminAuth } from '@/lib/api/admin-auth';
import { CHECKOUT_SOURCE, getPaymentProvider } from '@/lib/checkout/payment-provider';
import { attemptRecoveryOrderCreation } from '@/lib/checkout/payment-recovery';
import { findUnreconciledPayments, getPaymentRecord } from '@/lib/checkout/payment-records';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import { sendAdminAlert } from '@/lib/email/alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Payment reconciliation cron.
 *
 * The payment webhook deliberately stands down whenever checkout might still
 * be creating the order — that guard is what stopped the duplicate-order
 * pairs, but it also means a checkout that genuinely dies mid-flight no longer
 * gets recovered inline. This sweep is the backstop.
 *
 * It reads candidates from `maleq_payment_intent_orders` rather than paging
 * the processor's payment list: the rows are ours, indexed on
 * (status, created_at), and survive a change of processor. The one fact the
 * table cannot know is whether the payment actually succeeded, so each
 * candidate is confirmed against the provider — inside
 * `attemptRecoveryOrderCreation`, which re-reads the payment and bails unless
 * it is in a succeeded state.
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
    const provider = getPaymentProvider();
    const candidates = await findUnreconciledPayments({
      minAgeMs: MIN_AGE_MS,
      maxAgeMs: MAX_AGE_MS,
      limit: 100,
    });

    const recovered: string[] = [];
    const skipped: string[] = [];

    for (const record of candidates) {
      const paymentId = record.paymentIntentId;

      if (record.status === 'processing') {
        // A row still held this long after payment means checkout died between
        // taking the lock and creating the order. Nothing can release it now,
        // so surface it rather than silently leaving the payment unfulfilled —
        // clearing the row is a deliberate human decision.
        await reportStuckReservation(provider, record.paymentIntentId, record.createdAt);
        skipped.push(paymentId);
        continue;
      }

      // Unclaimed row: either checkout never got off the ground, or it failed
      // and handed the lock back. Recovery confirms the payment succeeded
      // before creating anything.
      const before = Date.now();
      await attemptRecoveryOrderCreation(paymentId, { skipGrace: true });
      recovered.push(paymentId);

      // Keep the sweep inside maxDuration even with a slow provider.
      if (Date.now() - startTime > 90_000) {
        await logDurableEvent({
          eventType: 'payment_reconcile_truncated',
          severity: 'warning',
          message: 'Reconciliation sweep hit its time budget — remaining rows deferred',
          payload: {
            processed: recovered.length + skipped.length,
            pending: candidates.length - (recovered.length + skipped.length),
            lastItemMs: Date.now() - before,
          },
        });
        break;
      }
    }

    // Secondary net: payments the processor knows about that we have no row
    // for at all. Only reachable if `create-intent` could not write its
    // snapshot, so this normally finds nothing.
    const orphaned = await sweepProviderOrphans(provider, startTime, recovered);

    const duration = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      duration: `${duration}s`,
      scanned: candidates.length,
      recoveryAttempted: recovered,
      skipped,
      orphaned,
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

/**
 * Find succeeded payments from our checkout that have no row in
 * `maleq_payment_intent_orders` — the blind spot the local sweep cannot see,
 * because a snapshot write is what creates the row in the first place.
 *
 * Skipped entirely when the provider cannot list payments.
 */
async function sweepProviderOrphans(
  provider: ReturnType<typeof getPaymentProvider>,
  startTime: number,
  alreadyHandled: string[]
): Promise<string[]> {
  if (!provider.listRecentPayments) return [];
  if (Date.now() - startTime > 60_000) return [];

  const handled = new Set(alreadyHandled);
  const orphaned: string[] = [];

  try {
    const payments = await provider.listRecentPayments(Date.now() - MAX_AGE_MS);

    for (const payment of payments) {
      if (payment.status !== 'succeeded') continue;
      if (payment.source !== CHECKOUT_SOURCE) continue;
      if (payment.orderReference) continue;
      if (handled.has(payment.id)) continue;
      // Same in-flight guard the local sweep applies.
      if (Date.now() - payment.createdAtMs < MIN_AGE_MS) continue;

      const record = await getPaymentRecord(payment.id);
      if (record) continue; // The local sweep owns it.

      await logDurableEvent({
        eventType: 'payment_reconcile_orphan_found',
        severity: 'warning',
        message: 'Succeeded payment with no local checkout record — snapshot write must have failed',
        paymentIntentId: payment.id,
        payload: { amount: payment.amountCents },
      });

      await attemptRecoveryOrderCreation(payment.id, { skipGrace: true });
      orphaned.push(payment.id);

      if (Date.now() - startTime > 100_000) break;
    }
  } catch (error) {
    console.warn('[Cron] Provider orphan sweep failed:', error);
  }

  return orphaned;
}

/**
 * Alert on a reservation that has been held with no order for far longer than
 * any request could run. Only worth a human's attention if the payment
 * actually went through, so confirm that first.
 */
async function reportStuckReservation(
  provider: ReturnType<typeof getPaymentProvider>,
  paymentId: string,
  createdAt: Date
): Promise<void> {
  let amountLabel = 'unknown';
  let email = 'N/A';

  try {
    const payment = await provider.retrievePayment(paymentId);
    if (payment.status !== 'succeeded') return;
    amountLabel = `$${(payment.amountCents / 100).toFixed(2)}`;
    email = payment.receiptEmail || 'N/A';
  } catch {
    // Provider unreachable — still worth surfacing the stuck row.
  }

  const ageMinutes = Math.round((Date.now() - createdAt.getTime()) / 60000);

  await logDurableEvent({
    eventType: 'payment_reconcile_stuck_reservation',
    severity: 'warning',
    message: 'Payment reservation stuck in processing with no order',
    paymentIntentId: paymentId,
    payload: { ageMinutes },
  });

  await sendAdminAlert('Stuck Checkout Reservation', {
    'PaymentIntent': paymentId,
    'Amount': amountLabel,
    'Customer Email': email,
    'Age': `${ageMinutes} min`,
    'Action':
      'Confirm no WooCommerce order exists, then delete the row from maleq_payment_intent_orders to let recovery run.',
  });
}
