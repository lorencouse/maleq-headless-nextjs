import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { verifyAdminAuth } from '@/lib/api/admin-auth';
import { getPoolAsync } from '@/lib/db/pool';

interface SummaryRow extends RowDataPacket {
  checkout_intent_created: number;
  checkout_intent_failed: number;
  checkout_order_created: number;
  checkout_order_create_failed: number;
  checkout_order_validation_failed: number;
  checkout_order_total_mismatch: number;
  checkout_order_amount_mismatch: number;
  checkout_order_payment_incomplete: number;
  stripe_payment_succeeded: number;
  stripe_payment_failed: number;
  stripe_payment_succeeded_unmatched: number;
  stripe_payment_failed_unmatched: number;
}

interface ErrorRow extends RowDataPacket {
  id: number;
  event_type: string;
  severity: 'warning' | 'error';
  message: string;
  payment_intent_id: string | null;
  order_id: number | null;
  created_at: string;
}

interface TopPathRow extends RowDataPacket {
  request_path: string | null;
  hits: number;
}

interface EventCountRow extends RowDataPacket {
  event_type: string;
  hits: number;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function toCutoffDateTime(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export async function GET(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    const search = request.nextUrl.searchParams;
    const sinceHours = Math.min(parsePositiveInt(search.get('sinceHours'), 24), 24 * 365);
    const errorLimit = Math.min(parsePositiveInt(search.get('errorLimit'), 20), 100);
    const cutoff = toCutoffDateTime(sinceHours);

    const pool = await getPoolAsync();

    const [summaryRows] = await pool.execute<SummaryRow[]>(
      `SELECT
         SUM(event_type = 'checkout_intent_created') AS checkout_intent_created,
         SUM(event_type = 'checkout_intent_failed') AS checkout_intent_failed,
         SUM(event_type = 'checkout_order_created') AS checkout_order_created,
         SUM(event_type = 'checkout_order_create_failed') AS checkout_order_create_failed,
         SUM(event_type = 'checkout_order_validation_failed') AS checkout_order_validation_failed,
         SUM(event_type = 'checkout_order_total_mismatch') AS checkout_order_total_mismatch,
         SUM(event_type = 'checkout_order_amount_mismatch') AS checkout_order_amount_mismatch,
         SUM(event_type = 'checkout_order_payment_incomplete') AS checkout_order_payment_incomplete,
         SUM(event_type = 'stripe_payment_succeeded') AS stripe_payment_succeeded,
         SUM(event_type = 'stripe_payment_failed') AS stripe_payment_failed,
         SUM(event_type = 'stripe_payment_succeeded_unmatched') AS stripe_payment_succeeded_unmatched,
         SUM(event_type = 'stripe_payment_failed_unmatched') AS stripe_payment_failed_unmatched
       FROM maleq_event_log
       WHERE created_at >= ?`,
      [cutoff]
    );

    const summary = summaryRows[0] || {
      checkout_intent_created: 0,
      checkout_intent_failed: 0,
      checkout_order_created: 0,
      checkout_order_create_failed: 0,
      checkout_order_validation_failed: 0,
      checkout_order_total_mismatch: 0,
      checkout_order_amount_mismatch: 0,
      checkout_order_payment_incomplete: 0,
      stripe_payment_succeeded: 0,
      stripe_payment_failed: 0,
      stripe_payment_succeeded_unmatched: 0,
      stripe_payment_failed_unmatched: 0,
    };

    const [errorRows] = await pool.query<ErrorRow[]>(
      `SELECT
         id,
         event_type,
         severity,
         message,
         payment_intent_id,
         order_id,
         created_at
       FROM maleq_event_log
       WHERE created_at >= ?
         AND severity IN ('warning', 'error')
       ORDER BY id DESC
       LIMIT ${errorLimit}`,
      [cutoff]
    );

    const [top404Rows] = await pool.query<TopPathRow[]>(
      `SELECT
         request_path,
         COUNT(*) AS hits
       FROM maleq_event_log
       WHERE created_at >= ?
         AND event_type = 'not_found_page_view'
       GROUP BY request_path
       ORDER BY hits DESC
       LIMIT 20`,
      [cutoff]
    );

    const [checkoutErrorRows] = await pool.query<EventCountRow[]>(
      `SELECT
         event_type,
         COUNT(*) AS hits
       FROM maleq_event_log
       WHERE created_at >= ?
         AND event_type IN (
           'checkout_intent_failed',
           'checkout_order_create_failed',
           'checkout_order_validation_failed',
           'checkout_order_total_mismatch',
           'checkout_order_amount_mismatch',
           'checkout_order_payment_incomplete',
           'stripe_payment_failed',
           'stripe_payment_failed_unmatched',
           'stripe_webhook_handler_failed'
         )
       GROUP BY event_type
       ORDER BY hits DESC`,
      [cutoff]
    );

    const intentCreated = Number(summary.checkout_intent_created || 0);
    const orderCreated = Number(summary.checkout_order_created || 0);
    const paid = Number(summary.stripe_payment_succeeded || 0);

    return NextResponse.json({
      success: true,
      window: { sinceHours, cutoffUtc: cutoff.replace(' ', 'T') + 'Z' },
      funnel: {
        checkoutIntentCreated: intentCreated,
        checkoutIntentFailed: Number(summary.checkout_intent_failed || 0),
        checkoutOrderCreated: orderCreated,
        checkoutOrderCreateFailed: Number(summary.checkout_order_create_failed || 0),
        checkoutOrderValidationFailed: Number(summary.checkout_order_validation_failed || 0),
        checkoutOrderTotalMismatch: Number(summary.checkout_order_total_mismatch || 0),
        checkoutOrderAmountMismatch: Number(summary.checkout_order_amount_mismatch || 0),
        checkoutOrderPaymentIncomplete: Number(summary.checkout_order_payment_incomplete || 0),
        stripePaymentSucceeded: paid,
        stripePaymentFailed: Number(summary.stripe_payment_failed || 0),
        stripePaymentSucceededUnmatched: Number(summary.stripe_payment_succeeded_unmatched || 0),
        stripePaymentFailedUnmatched: Number(summary.stripe_payment_failed_unmatched || 0),
      },
      rates: {
        intentToOrderPct: pct(orderCreated, intentCreated),
        orderToPaidWebhookPct: pct(paid, orderCreated),
        intentToPaidWebhookPct: pct(paid, intentCreated),
      },
      seo: {
        top404Paths: top404Rows
          .filter((row) => row.request_path)
          .map((row) => ({
            path: row.request_path,
            hits: Number(row.hits || 0),
          })),
      },
      checkoutErrors: checkoutErrorRows.map((row) => ({
        eventType: row.event_type,
        hits: Number(row.hits || 0),
      })),
      recentIssues: errorRows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        severity: row.severity,
        message: row.message,
        paymentIntentId: row.payment_intent_id,
        orderId: row.order_id,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build event summary';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
