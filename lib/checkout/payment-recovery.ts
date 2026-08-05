import type Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { createOrder, CreateOrderData, OrderAddress } from '@/lib/woocommerce/orders';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import {
  lookupPaymentIntentReservation,
  markPaymentIntentOrderComplete,
  releasePaymentIntentReservation,
  reservePaymentIntent,
} from '@/lib/checkout/payment-intent-lock';
import { readCartItemsFromMetadata } from '@/lib/checkout/cart-metadata';

/**
 * Recovery-order creation for Stripe payments that never produced a
 * WooCommerce order.
 *
 * Shared by the Stripe webhook (`payment_intent.succeeded`) and the
 * reconciliation cron, so both go through the identical duplicate guards.
 */

/**
 * How long the webhook waits for `/api/orders/create` to finish before it will
 * even consider creating a recovery order.
 *
 * `payment_intent.succeeded` is delivered the moment the customer's card is
 * confirmed — routinely *before* the browser's order-creation round-trip has
 * reached WooCommerce (that route re-prices the cart and re-validates the
 * intent first). Recovering immediately is what produced duplicate order pairs.
 * Stripe times webhook deliveries out at ~20s, so this stays well under that.
 */
const RECOVERY_GRACE_MS = 12_000;
const RECOVERY_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to create a WooCommerce order from Stripe PaymentIntent metadata
 * when the frontend order creation failed. This is the last-resort safety net.
 *
 * Ordering matters here, and every step exists to prevent a duplicate order:
 *   1. wait out the frontend's normal order-creation window
 *   2. take the *same* `maleq_payment_intent_orders` lock `/api/orders/create`
 *      uses — whoever loses simply stands down
 *   3. re-read PaymentIntent metadata from Stripe, since the copy on the event
 *      is a snapshot from before the frontend could have stamped the order ID
 *
 * Requires checkout_cart_items in PI metadata (added after 2026-04-15).
 * Falls back to a fee-line placeholder if cart items are unavailable.
 *
 * @param options.skipGrace set by the reconciliation cron, which only ever sees
 *   PaymentIntents that have already been unmatched for many minutes.
 */
export async function attemptRecoveryOrderCreation(
  paymentIntent: Stripe.PaymentIntent,
  options: { skipGrace?: boolean } = {}
) {
  const meta = paymentIntent.metadata || {};
  const email = paymentIntent.receipt_email || meta.customer_email || '';
  const amount = (paymentIntent.amount / 100).toFixed(2);

  if (meta.source !== 'maleq-headless-checkout') {
    // Not from our checkout — don't create an order automatically.
    console.warn(
      `payment_intent.succeeded: Unrecognized source for ${paymentIntent.id}, skipping recovery`
    );
    await logDurableEvent({
      eventType: 'stripe_payment_succeeded_unmatched',
      severity: 'warning',
      message: 'payment_intent.succeeded with no matching WooCommerce order (non-checkout source)',
      paymentIntentId: paymentIntent.id,
      payload: { amount: paymentIntent.amount, receiptEmail: email || null },
    });
    await sendAdminAlert('Payment Succeeded — No WooCommerce Order', {
      'PaymentIntent': paymentIntent.id,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
    });
    return;
  }

  // ---- Duplicate-order guards -------------------------------------------

  if (!options.skipGrace) {
    const settledOrderId = await waitForFrontendOrder(paymentIntent.id);
    if (settledOrderId) {
      console.log(
        `payment_intent.succeeded: Frontend created order #${settledOrderId} for ${paymentIntent.id}, skipping recovery`
      );
      await logDurableEvent({
        eventType: 'stripe_webhook_recovery_skipped',
        message: 'Frontend order landed during grace window — recovery not needed',
        paymentIntentId: paymentIntent.id,
        orderId: settledOrderId,
      });
      return;
    }
  }

  // Take the same lock `/api/orders/create` uses. Losing it means the frontend
  // owns this payment — it will either finish (and own the order) or fail and
  // release, at which point the reconciliation cron picks it up.
  let reservationHeld = false;
  try {
    const reservation = await reservePaymentIntent(paymentIntent.id);
    if (!reservation.acquired) {
      console.log(
        `payment_intent.succeeded: Checkout holds the reservation for ${paymentIntent.id} (order ${reservation.orderId ?? 'pending'}), skipping recovery`
      );
      await logDurableEvent({
        eventType: 'stripe_webhook_recovery_skipped',
        message: 'Checkout route holds the payment intent reservation — recovery not attempted',
        paymentIntentId: paymentIntent.id,
        orderId: reservation.orderId,
        payload: { reservationStatus: reservation.status },
      });
      return;
    }
    reservationHeld = true;
  } catch (error) {
    // Without the lock we cannot rule out a duplicate. A missed recovery is
    // recoverable by hand; a duplicate order double-reduces stock and spams
    // the customer and admin, so fail closed and alert instead.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `payment_intent.succeeded: Reservation lock unavailable for ${paymentIntent.id}:`,
      message
    );
    await logDurableEvent({
      eventType: 'stripe_webhook_recovery_lock_failed',
      severity: 'error',
      message: 'Could not reach the payment intent reservation table — recovery skipped',
      paymentIntentId: paymentIntent.id,
      payload: { error: message },
    });
    await sendAdminAlert('Recovery Skipped — Reservation Lock Unavailable', {
      'PaymentIntent': paymentIntent.id,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Error': message,
      'Action': 'Check the order exists in WooCommerce; create it manually if not.',
    });
    return;
  }

  // Final check against Stripe itself: the event payload carries a metadata
  // snapshot taken before the frontend could have stamped the order ID.
  try {
    const stripe = getStripeServer();
    const fresh = await stripe.paymentIntents.retrieve(paymentIntent.id);
    const freshOrderId = fresh.metadata?.woocommerce_order_id;
    if (freshOrderId) {
      await releasePaymentIntentReservation(paymentIntent.id);
      console.log(
        `payment_intent.succeeded: Order #${freshOrderId} already recorded on ${paymentIntent.id}, skipping recovery`
      );
      await logDurableEvent({
        eventType: 'stripe_webhook_recovery_skipped',
        message: 'PaymentIntent already carries a WooCommerce order ID — recovery not needed',
        paymentIntentId: paymentIntent.id,
        orderId: parseInt(freshOrderId, 10) || null,
      });
      return;
    }
  } catch {
    // Metadata re-read is best-effort; the reservation lock is the real guard.
  }

  // ---- Build and create the recovery order ------------------------------

  // Build shipping address from Stripe shipping data
  const stripeShipping = paymentIntent.shipping;
  const nameParts = (stripeShipping?.name || '').split(' ');
  const firstName = nameParts[0] || 'Unknown';
  const lastName = nameParts.slice(1).join(' ') || 'Customer';
  const address: OrderAddress = {
    first_name: firstName,
    last_name: lastName,
    company: '',
    address_1: stripeShipping?.address?.line1 || '',
    address_2: stripeShipping?.address?.line2 || '',
    city: stripeShipping?.address?.city || '',
    state: stripeShipping?.address?.state || '',
    postcode: stripeShipping?.address?.postal_code || '',
    country: stripeShipping?.address?.country || 'US',
    email,
    phone: stripeShipping?.phone || '',
  };

  // Parse cart items if available (chunked across metadata keys; legacy
  // truncated values are repaired to whatever prefix is still valid)
  const { items: parsedCartItems, repaired: cartItemsRepaired } =
    readCartItemsFromMetadata(meta);
  const lineItems: CreateOrderData['line_items'] = parsedCartItems.map(
    ([productId, variationId, quantity]) => ({
      product_id: parseInt(productId, 10),
      ...(variationId ? { variation_id: parseInt(variationId, 10) } : {}),
      quantity,
    })
  );
  const hasCartItems = lineItems.length > 0;

  const shippingTotal = meta.checkout_shipping || '0.00';
  const discountAmount = parseFloat(meta.checkout_discount || '0');

  const orderData: CreateOrderData = {
    payment_method: 'stripe',
    payment_method_title: 'Credit Card (Stripe)',
    set_paid: true,
    billing: address,
    shipping: address,
    line_items: hasCartItems
      ? lineItems
      : [],
    ...(!hasCartItems && {
      fee_lines: [
        {
          name: 'Recovered payment — items unknown (contact customer)',
          total: meta.checkout_subtotal || amount,
        },
        ...(discountAmount > 0
          ? [{ name: 'Automatic discount', total: (-discountAmount).toFixed(2) }]
          : []),
      ],
    }),
    shipping_lines: [
      {
        method_id: meta.shipping_method_id || 'standard',
        method_title: meta.shipping_method_id === 'express' ? 'Express Shipping' : 'Standard Shipping',
        total: shippingTotal,
      },
    ],
    transaction_id: paymentIntent.id,
    meta_data: [
      { key: '_stripe_payment_intent_id', value: paymentIntent.id },
      { key: '_order_source', value: 'maleq-headless-webhook-recovery' },
      { key: '_recovery_has_cart_items', value: hasCartItems ? 'yes' : 'no' },
      ...(cartItemsRepaired
        ? [{ key: '_recovery_cart_items_repaired', value: 'yes' }]
        : []),
    ],
    customer_note: !hasCartItems
      ? 'WEBHOOK RECOVERY: Order was automatically created from Stripe webhook because frontend order creation failed. Cart items could not be recovered — contact customer to confirm items before shipping.'
      : cartItemsRepaired
        ? 'WEBHOOK RECOVERY: Order was automatically created from Stripe webhook because frontend order creation failed. The cart metadata was truncated, so this item list may be incomplete — confirm against the Stripe charge total before shipping.'
        : 'WEBHOOK RECOVERY: Order was automatically created from Stripe webhook because frontend order creation failed.',
  };

  // Add auto-discount as fee line when we have real line items
  if (hasCartItems && discountAmount > 0) {
    orderData.fee_lines = [
      { name: 'Automatic discount', total: (-discountAmount).toFixed(2) },
    ];
  }

  try {
    const order = await createOrder(orderData);

    // Stamp the reservation before anything else can race us, then mirror it
    // onto the PaymentIntent metadata.
    if (reservationHeld) {
      reservationHeld = false;
      await markPaymentIntentOrderComplete(paymentIntent.id, order.id).catch((error) => {
        console.error(
          `payment_intent.succeeded: Failed to record reservation for recovery order #${order.id}:`,
          error
        );
      });
    }

    const stripe = getStripeServer();
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { woocommerce_order_id: String(order.id) },
    });

    console.log(
      `payment_intent.succeeded: Created recovery order #${order.id} for ${paymentIntent.id}`
    );

    await logDurableEvent({
      eventType: 'stripe_webhook_recovery_order_created',
      message: `Created recovery WooCommerce order ${order.id} from webhook`,
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      payload: {
        amount: paymentIntent.amount,
        receiptEmail: email || null,
        hasCartItems,
        lineItemCount: lineItems.length,
      },
    });

    await sendAdminAlert('Webhook Recovery Order Created', {
      'Order ID': order.id,
      'PaymentIntent': paymentIntent.id,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Has Cart Items': hasCartItems ? 'Yes' : 'No — contact customer',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `payment_intent.succeeded: Failed to create recovery order for ${paymentIntent.id}:`,
      message
    );

    // Hand the lock back so checkout (or the reconciliation cron) can retry.
    if (reservationHeld) {
      reservationHeld = false;
      await releasePaymentIntentReservation(paymentIntent.id).catch(() => {});
    }

    await logDurableEvent({
      eventType: 'stripe_webhook_recovery_order_failed',
      severity: 'error',
      message: `Failed to create recovery order from webhook for ${paymentIntent.id}`,
      paymentIntentId: paymentIntent.id,
      payload: {
        amount: paymentIntent.amount,
        receiptEmail: email || null,
        error: message,
      },
    });

    await sendAdminAlert('Payment Succeeded — Recovery Order FAILED', {
      'PaymentIntent': paymentIntent.id,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Error': message,
    });
  }
}

/**
 * Poll the reservation table for the duration of the grace window, waiting for
 * `/api/orders/create` to land an order for this payment.
 *
 * Returns the order ID as soon as checkout records one. Returns null if the
 * window expires — either because checkout never started, or because it is
 * still in flight (in which case the reservation lock, taken next, stops us).
 */
async function waitForFrontendOrder(paymentIntentId: string): Promise<number | null> {
  const deadline = Date.now() + RECOVERY_GRACE_MS;

  while (Date.now() < deadline) {
    try {
      const reservation = await lookupPaymentIntentReservation(paymentIntentId);
      if (reservation?.orderId) return reservation.orderId;
    } catch {
      // DB hiccup — the reservation lock below is the authoritative guard.
      return null;
    }
    await sleep(Math.min(RECOVERY_POLL_MS, Math.max(0, deadline - Date.now())));
  }

  return null;
}

