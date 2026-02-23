import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { updateOrder } from '@/lib/woocommerce/orders';
import { getWooCommerceEndpoint, getAuthHeader, isWooCommerceConfigured } from '@/lib/woocommerce/auth';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';

/**
 * Stripe Webhook Handler
 *
 * Handles asynchronous payment events from Stripe.
 * Verifies webhook signature to ensure requests are authentic.
 *
 * Events handled:
 * - payment_intent.succeeded: Confirms order is marked as paid
 * - payment_intent.payment_failed: Marks order as failed
 * - charge.refunded: Updates order status to refunded
 * - charge.dispute.created: Flags order as disputed (on-hold)
 */

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('Stripe webhook secret not configured');
    await logDurableEvent({
      eventType: 'stripe_webhook_config_error',
      severity: 'error',
      message: 'Stripe webhook secret not configured',
      requestPath: request.nextUrl.pathname,
    });
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    await logDurableEvent({
      eventType: 'stripe_webhook_missing_signature',
      severity: 'warning',
      message: 'Missing stripe-signature header',
      requestPath: request.nextUrl.pathname,
    });
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    const stripe = getStripeServer();
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', message);
    await logDurableEvent({
      eventType: 'stripe_webhook_invalid_signature',
      severity: 'warning',
      message: 'Webhook signature verification failed',
      requestPath: request.nextUrl.pathname,
      payload: { error: message },
    });
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;

      default:
        // Acknowledge unhandled events without error
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Error handling Stripe event ${event.type}:`, error);
    const pi = event.data.object as { id?: string };
    sendAdminAlert('Webhook Handler Failed', {
      'Event Type': event.type,
      'Event ID': event.id,
      'PaymentIntent': pi.id || 'N/A',
      'Error': error instanceof Error ? error.message : String(error),
    });
    await logDurableEvent({
      eventType: 'stripe_webhook_handler_failed',
      severity: 'error',
      message: `Webhook handler failed for ${event.type}`,
      eventId: event.id,
      paymentIntentId: pi.id || null,
      requestPath: request.nextUrl.pathname,
      payload: {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    // Return 500 so Stripe retries transient failures.
    return NextResponse.json({ received: false, error: 'Handler failed' }, { status: 500 });
  }
}

/**
 * Payment succeeded — ensure the WooCommerce order is marked as processing.
 * This is a safety net for cases where the frontend order creation succeeded
 * but the status update didn't, or for async payment methods (bank transfers, etc.)
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const orderId = await findWooCommerceOrderId(paymentIntent);
  if (!orderId) {
    console.warn(
      `payment_intent.succeeded: No WooCommerce order ID found for ${paymentIntent.id}`
    );
    await logDurableEvent({
      eventType: 'stripe_payment_succeeded_unmatched',
      severity: 'warning',
      message: 'payment_intent.succeeded with no matching WooCommerce order',
      paymentIntentId: paymentIntent.id,
      payload: {
        amount: paymentIntent.amount,
        receiptEmail: paymentIntent.receipt_email || null,
      },
    });
    sendAdminAlert('Payment Succeeded — No WooCommerce Order', {
      'PaymentIntent': paymentIntent.id,
      'Amount': `$${(paymentIntent.amount / 100).toFixed(2)}`,
      'Customer Email': paymentIntent.receipt_email || 'N/A',
    });
    return;
  }

  console.log(
    `payment_intent.succeeded: Confirming order #${orderId} is paid (${paymentIntent.id})`
  );

  await updateOrder(orderId, {
    status: 'processing',
    set_paid: true,
    transaction_id: paymentIntent.id,
  });
}

/**
 * Payment failed — mark the WooCommerce order as failed.
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const orderId = await findWooCommerceOrderId(paymentIntent);
  if (!orderId) {
    console.warn(
      `payment_intent.payment_failed: No WooCommerce order ID found for ${paymentIntent.id}`
    );
    await logDurableEvent({
      eventType: 'stripe_payment_failed_unmatched',
      severity: 'warning',
      message: 'payment_intent.payment_failed with no matching WooCommerce order',
      paymentIntentId: paymentIntent.id,
      payload: {
        amount: paymentIntent.amount,
        failureMessage: paymentIntent.last_payment_error?.message || null,
      },
    });
    return;
  }

  const failureMessage =
    paymentIntent.last_payment_error?.message || 'Payment failed';

  console.log(
    `payment_intent.payment_failed: Marking order #${orderId} as failed (${paymentIntent.id}): ${failureMessage}`
  );

  sendAdminAlert('Payment Failed', {
    'Order ID': orderId,
    'PaymentIntent': paymentIntent.id,
    'Failure Reason': failureMessage,
    'Customer Email': paymentIntent.receipt_email || 'N/A',
    'Amount': `$${(paymentIntent.amount / 100).toFixed(2)}`,
  });

  await updateOrder(orderId, {
    status: 'failed',
    meta_data: [
      { key: '_stripe_payment_failure', value: failureMessage },
    ],
  });
}

/**
 * Charge refunded — update the WooCommerce order status.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn('charge.refunded: No payment intent on charge', charge.id);
    return;
  }

  // Retrieve the full PaymentIntent to get metadata
  const stripe = getStripeServer();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const orderId = await findWooCommerceOrderId(paymentIntent);

  if (!orderId) {
    console.warn(
      `charge.refunded: No WooCommerce order ID found for ${paymentIntentId}`
    );
    return;
  }

  const isFullRefund = charge.amount_refunded === charge.amount;

  console.log(
    `charge.refunded: ${isFullRefund ? 'Full' : 'Partial'} refund on order #${orderId} (${paymentIntentId})`
  );

  await updateOrder(orderId, {
    status: isFullRefund ? 'refunded' : 'processing',
    meta_data: [
      {
        key: '_stripe_refund_amount',
        value: (charge.amount_refunded / 100).toFixed(2),
      },
      {
        key: '_stripe_refund_status',
        value: isFullRefund ? 'full' : 'partial',
      },
    ],
  });
}

/**
 * Dispute created — put the WooCommerce order on hold.
 */
async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn('charge.dispute.created: No payment intent on dispute', dispute.id);
    return;
  }

  const stripe = getStripeServer();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const orderId = await findWooCommerceOrderId(paymentIntent);

  if (!orderId) {
    console.warn(
      `charge.dispute.created: No WooCommerce order ID found for ${paymentIntentId}`
    );
    return;
  }

  console.log(
    `charge.dispute.created: Putting order #${orderId} on hold — reason: ${dispute.reason} (${dispute.id})`
  );

  sendAdminAlert('Dispute Created', {
    'Order ID': orderId,
    'Dispute ID': dispute.id,
    'Reason': dispute.reason,
    'Amount': `$${(dispute.amount / 100).toFixed(2)}`,
    'PaymentIntent': paymentIntentId,
  });

  await updateOrder(orderId, {
    status: 'on-hold',
    meta_data: [
      { key: '_stripe_dispute_id', value: dispute.id },
      { key: '_stripe_dispute_reason', value: dispute.reason },
      {
        key: '_stripe_dispute_amount',
        value: (dispute.amount / 100).toFixed(2),
      },
    ],
  });
}

/**
 * Extract WooCommerce order ID from PaymentIntent metadata.
 *
 * The order ID gets stored in metadata when the frontend creates the order.
 * Falls back to searching by transaction_id if metadata is missing.
 */
async function findWooCommerceOrderId(
  paymentIntent: Stripe.PaymentIntent
): Promise<number | null> {
  // Check metadata first (fastest)
  const metaOrderId = paymentIntent.metadata?.woocommerce_order_id;
  if (metaOrderId) {
    const parsed = parseInt(metaOrderId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Fallback: look up order by PaymentIntent ID in transaction_id/meta_data.
  if (!isWooCommerceConfigured()) {
    return null;
  }

  try {
    const piId = paymentIntent.id;
    const url = getWooCommerceEndpoint(
      `/orders?search=${encodeURIComponent(piId)}&per_page=20&orderby=date&order=desc`
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(),
      },
    });

    if (!response.ok) {
      console.warn(
        `findWooCommerceOrderId: fallback order lookup failed for ${piId} (${response.status})`
      );
      return null;
    }

    const orders = (await response.json()) as Array<{
      id: number;
      transaction_id?: string;
      meta_data?: Array<{ key: string; value: unknown }>;
    }>;

    const matchedOrder = orders.find((order) => {
      if (order.transaction_id === piId) return true;
      const meta = order.meta_data || [];
      return meta.some(
        (entry) =>
          entry.key === '_stripe_payment_intent_id' &&
          String(entry.value || '') === piId
      );
    });

    return matchedOrder?.id ?? null;
  } catch (error) {
    console.warn(
      `findWooCommerceOrderId: fallback lookup exception for ${paymentIntent.id}`,
      error
    );
    return null;
  }

  return null;
}
