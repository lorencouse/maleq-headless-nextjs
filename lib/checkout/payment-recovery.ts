import { createOrder, CreateOrderData, OrderAddress } from '@/lib/woocommerce/orders';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import {
  getPaymentRecord,
  lookupPaymentIntentReservation,
  markPaymentAbandoned,
  markPaymentIntentOrderComplete,
  releasePaymentIntentReservation,
  reservePaymentIntent,
  type CheckoutSnapshot,
  type CheckoutSnapshotAddress,
} from '@/lib/checkout/payment-records';
import {
  CHECKOUT_SOURCE,
  getPaymentProvider,
  type ProviderPayment,
} from '@/lib/checkout/payment-provider';
import { readCartItemsFromMetadata } from '@/lib/checkout/cart-metadata';
import type { CompactCartItem } from '@/lib/checkout/cart-metadata';

/**
 * Recovery-order creation for payments that never produced a WooCommerce
 * order.
 *
 * Shared by the payment webhook and the reconciliation cron, so both go
 * through the identical duplicate guards.
 *
 * The cart is rebuilt from the checkout snapshot in
 * `maleq_payment_intent_orders`. Payments created before snapshots existed
 * still carry their cart in provider metadata, so that read is kept as a
 * fallback — it can be deleted once no un-reconciled payments predate the
 * snapshot rollout (they age out after MAX_AGE_MS in the reconcile cron).
 */

/**
 * How long the webhook waits for `/api/orders/create` to finish before it will
 * even consider creating a recovery order.
 *
 * Payment-succeeded events are delivered the moment the customer's card is
 * confirmed — routinely *before* the browser's order-creation round-trip has
 * reached WooCommerce (that route re-prices the cart and re-validates the
 * payment first). Recovering immediately is what produced duplicate order
 * pairs. Stripe times webhook deliveries out at ~20s, so this stays well under
 * that.
 */
const RECOVERY_GRACE_MS = 12_000;
const RECOVERY_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RecoveryCart {
  items: CompactCartItem[];
  /** True when the item list came from a legacy metadata value we repaired. */
  repaired: boolean;
  /** Where the cart was read from, for the audit trail on the order. */
  origin: 'snapshot' | 'provider-metadata' | 'none';
}

/**
 * Attempt to create a WooCommerce order for a payment whose checkout never
 * produced one. This is the last-resort safety net.
 *
 * Ordering matters here, and every step exists to prevent a duplicate order:
 *   1. wait out the frontend's normal order-creation window
 *   2. take the *same* `maleq_payment_intent_orders` lock `/api/orders/create`
 *      uses — whoever loses simply stands down
 *   3. re-read the record and the payment, since anything read before the lock
 *      is a snapshot from before the frontend could have stamped the order ID
 *
 * @param options.skipGrace set by the reconciliation cron, which only ever
 *   sees payments that have already been unmatched for many minutes.
 */
export async function attemptRecoveryOrderCreation(
  paymentId: string,
  options: { skipGrace?: boolean } = {}
) {
  const provider = getPaymentProvider();

  let payment: ProviderPayment;
  try {
    payment = await provider.retrievePayment(paymentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logDurableEvent({
      eventType: 'payment_recovery_lookup_failed',
      severity: 'error',
      message: 'Could not read the payment from the provider — recovery skipped',
      paymentIntentId: paymentId,
      payload: { error: message },
    });
    await sendAdminAlert('Recovery Skipped — Payment Lookup Failed', {
      'PaymentIntent': paymentId,
      'Error': message,
      'Action': 'Confirm the order exists in WooCommerce; create it manually if not.',
    });
    return;
  }

  if (payment.status !== 'succeeded') {
    // Nothing was captured, so there is nothing to fulfil. The overwhelmingly
    // common case is an abandoned checkout — the customer reached the payment
    // step and left — so this is deliberately not a durable event. Park the
    // row in `abandoned` instead, which takes it out of the reconciliation
    // sweep rather than re-asking the processor about it every 15 minutes.
    if (payment.status === 'failed' || payment.status === 'canceled') {
      await markPaymentAbandoned(paymentId).catch(() => {});
    }
    return;
  }

  const record = await getPaymentRecord(paymentId).catch(() => null);
  const amount = (payment.amountCents / 100).toFixed(2);
  const email =
    record?.customerEmail ||
    record?.snapshot?.customerEmail ||
    payment.receiptEmail ||
    payment.legacyMetadata.customer_email ||
    '';

  // A payment is ours if we recorded it, or if the provider still carries our
  // source tag (payments created before snapshots, and any provider that
  // supports metadata). Anything else gets flagged, never auto-fulfilled.
  const isOurs = Boolean(record) || payment.source === CHECKOUT_SOURCE;
  if (!isOurs) {
    console.warn(`Recovery: unrecognized source for ${paymentId}, skipping`);
    await logDurableEvent({
      eventType: 'payment_succeeded_unmatched',
      severity: 'warning',
      message: 'Succeeded payment with no matching WooCommerce order (non-checkout source)',
      paymentIntentId: paymentId,
      payload: { amount: payment.amountCents, receiptEmail: email || null },
    });
    await sendAdminAlert('Payment Succeeded — No WooCommerce Order', {
      'PaymentIntent': paymentId,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
    });
    return;
  }

  // ---- Duplicate-order guards -------------------------------------------

  if (record?.orderId) {
    await logDurableEvent({
      eventType: 'payment_recovery_skipped',
      message: 'Payment record already carries an order ID — recovery not needed',
      paymentIntentId: paymentId,
      orderId: record.orderId,
    });
    return;
  }

  if (!options.skipGrace) {
    const settledOrderId = await waitForFrontendOrder(paymentId);
    if (settledOrderId) {
      console.log(
        `Recovery: frontend created order #${settledOrderId} for ${paymentId}, skipping`
      );
      await logDurableEvent({
        eventType: 'payment_recovery_skipped',
        message: 'Frontend order landed during grace window — recovery not needed',
        paymentIntentId: paymentId,
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
    const reservation = await reservePaymentIntent(paymentId);
    if (!reservation.acquired) {
      console.log(
        `Recovery: checkout holds the reservation for ${paymentId} (order ${reservation.orderId ?? 'pending'}), skipping`
      );
      await logDurableEvent({
        eventType: 'payment_recovery_skipped',
        message: 'Checkout route holds the payment reservation — recovery not attempted',
        paymentIntentId: paymentId,
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
    console.error(`Recovery: reservation lock unavailable for ${paymentId}:`, message);
    await logDurableEvent({
      eventType: 'payment_recovery_lock_failed',
      severity: 'error',
      message: 'Could not reach the payment reservation table — recovery skipped',
      paymentIntentId: paymentId,
      payload: { error: message },
    });
    await sendAdminAlert('Recovery Skipped — Reservation Lock Unavailable', {
      'PaymentIntent': paymentId,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Error': message,
      'Action': 'Check the order exists in WooCommerce; create it manually if not.',
    });
    return;
  }

  // Re-read under the lock. The record we loaded above predates it, and the
  // provider-side reference is the last word for legacy payments whose order
  // was created before this table existed.
  const freshRecord = await getPaymentRecord(paymentId).catch(() => record);
  const priorOrderId = freshRecord?.orderId ?? parseOrderRef(payment.orderReference);
  if (priorOrderId) {
    await releasePaymentIntentReservation(paymentId);
    console.log(`Recovery: order #${priorOrderId} already recorded for ${paymentId}, skipping`);
    await logDurableEvent({
      eventType: 'payment_recovery_skipped',
      message: 'Payment already carries a WooCommerce order ID — recovery not needed',
      paymentIntentId: paymentId,
      orderId: priorOrderId,
    });
    return;
  }

  // ---- Build and create the recovery order ------------------------------

  const snapshot = freshRecord?.snapshot ?? record?.snapshot ?? null;
  const cart = resolveRecoveryCart(snapshot, payment);
  const address = buildRecoveryAddress(snapshot, payment, email);
  const orderData = buildRecoveryOrderData({
    paymentId,
    payment,
    snapshot,
    cart,
    address,
    amount,
  });

  try {
    const order = await createOrder(orderData);

    // Stamp the reservation before anything else can race us, then mirror it
    // onto the payment if the provider can hold it.
    if (reservationHeld) {
      reservationHeld = false;
      await markPaymentIntentOrderComplete(paymentId, order.id).catch((error) => {
        console.error(
          `Recovery: failed to record reservation for recovery order #${order.id}:`,
          error
        );
      });
    }

    await provider.attachOrderReference(paymentId, order.id).catch(() => {
      // Best-effort: the reservation table is authoritative.
    });

    console.log(`Recovery: created order #${order.id} for ${paymentId}`);

    await logDurableEvent({
      eventType: 'payment_recovery_order_created',
      message: `Created recovery WooCommerce order ${order.id}`,
      paymentIntentId: paymentId,
      orderId: order.id,
      payload: {
        amount: payment.amountCents,
        receiptEmail: email || null,
        cartOrigin: cart.origin,
        lineItemCount: cart.items.length,
      },
    });

    await sendAdminAlert('Recovery Order Created', {
      'Order ID': order.id,
      'PaymentIntent': paymentId,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Cart Source': cart.origin === 'none' ? 'UNKNOWN — contact customer' : cart.origin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Recovery: failed to create order for ${paymentId}:`, message);

    // Hand the lock back so checkout (or the reconciliation cron) can retry.
    if (reservationHeld) {
      reservationHeld = false;
      await releasePaymentIntentReservation(paymentId).catch(() => {});
    }

    await logDurableEvent({
      eventType: 'payment_recovery_order_failed',
      severity: 'error',
      message: `Failed to create recovery order for ${paymentId}`,
      paymentIntentId: paymentId,
      payload: {
        amount: payment.amountCents,
        receiptEmail: email || null,
        error: message,
      },
    });

    await sendAdminAlert('Payment Succeeded — Recovery Order FAILED', {
      'PaymentIntent': paymentId,
      'Amount': `$${amount}`,
      'Customer Email': email || 'N/A',
      'Error': message,
    });
  }
}

function parseOrderRef(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Cart line items, snapshot first. Provider metadata is only consulted for
 * payments created before snapshots were written.
 */
function resolveRecoveryCart(
  snapshot: CheckoutSnapshot | null,
  payment: ProviderPayment
): RecoveryCart {
  if (snapshot && snapshot.items.length > 0) {
    return { items: snapshot.items, repaired: false, origin: 'snapshot' };
  }

  const { items, repaired } = readCartItemsFromMetadata(payment.legacyMetadata);
  if (items.length > 0) {
    return { items, repaired, origin: 'provider-metadata' };
  }

  return { items: [], repaired: false, origin: 'none' };
}

function buildRecoveryAddress(
  snapshot: CheckoutSnapshot | null,
  payment: ProviderPayment,
  email: string
): OrderAddress {
  const source: CheckoutSnapshotAddress | null =
    snapshot?.shippingAddress ??
    (payment.shipping
      ? {
          name: payment.shipping.name,
          phone: payment.shipping.phone,
          line1: payment.shipping.line1,
          line2: payment.shipping.line2,
          city: payment.shipping.city,
          state: payment.shipping.state,
          postalCode: payment.shipping.postalCode,
          country: payment.shipping.country,
        }
      : null);

  const nameParts = (source?.name || '').trim().split(/\s+/).filter(Boolean);

  return {
    first_name: nameParts[0] || 'Unknown',
    last_name: nameParts.slice(1).join(' ') || 'Customer',
    company: '',
    address_1: source?.line1 || '',
    address_2: source?.line2 || '',
    city: source?.city || '',
    state: source?.state || '',
    postcode: source?.postalCode || '',
    country: source?.country || snapshot?.shippingCountry || 'US',
    email,
    phone: source?.phone || '',
  };
}

function buildRecoveryOrderData(params: {
  paymentId: string;
  payment: ProviderPayment;
  snapshot: CheckoutSnapshot | null;
  cart: RecoveryCart;
  address: OrderAddress;
  amount: string;
}): CreateOrderData {
  const { paymentId, payment, snapshot, cart, address, amount } = params;
  const meta = payment.legacyMetadata;

  const lineItems: CreateOrderData['line_items'] = cart.items.map(
    ([productId, variationId, quantity]) => ({
      product_id: parseInt(productId, 10),
      ...(variationId ? { variation_id: parseInt(variationId, 10) } : {}),
      quantity,
    })
  );
  const hasCartItems = lineItems.length > 0;

  const shippingTotal = (snapshot?.pricing.shipping ?? parseFloat(meta.checkout_shipping || '0'))
    .toFixed(2);
  const discountAmount = snapshot?.pricing.discount ?? parseFloat(meta.checkout_discount || '0');
  const subtotal = snapshot?.pricing.subtotal?.toFixed(2) ?? meta.checkout_subtotal ?? amount;
  const shippingMethodId = snapshot?.shippingMethod.id || meta.shipping_method_id || 'standard';
  const shippingMethodTitle =
    snapshot?.shippingMethod.name ||
    (shippingMethodId === 'express' ? 'Express Shipping' : 'Standard Shipping');

  const orderData: CreateOrderData = {
    payment_method: 'stripe',
    payment_method_title: 'Credit Card (Stripe)',
    set_paid: true,
    billing: address,
    shipping: address,
    line_items: hasCartItems ? lineItems : [],
    ...(!hasCartItems && {
      fee_lines: [
        { name: 'Recovered payment — items unknown (contact customer)', total: subtotal },
        ...(discountAmount > 0
          ? [{ name: 'Automatic discount', total: (-discountAmount).toFixed(2) }]
          : []),
      ],
    }),
    shipping_lines: [
      {
        method_id: shippingMethodId,
        method_title: shippingMethodTitle,
        total: shippingTotal,
      },
    ],
    transaction_id: paymentId,
    meta_data: [
      { key: '_stripe_payment_intent_id', value: paymentId },
      { key: '_order_source', value: 'maleq-headless-recovery' },
      { key: '_recovery_cart_origin', value: cart.origin },
      ...(cart.repaired ? [{ key: '_recovery_cart_items_repaired', value: 'yes' }] : []),
    ],
    customer_note: recoveryNote(cart),
  };

  // Add auto-discount as fee line when we have real line items
  if (hasCartItems && discountAmount > 0) {
    orderData.fee_lines = [{ name: 'Automatic discount', total: (-discountAmount).toFixed(2) }];
  }

  return orderData;
}

function recoveryNote(cart: RecoveryCart): string {
  const preamble =
    'RECOVERY: this order was created automatically because checkout took payment but failed to create the order.';

  if (cart.origin === 'none') {
    return `${preamble} The cart could not be recovered — contact the customer to confirm items before shipping.`;
  }
  if (cart.repaired) {
    return `${preamble} The stored cart was truncated, so this item list may be incomplete — confirm against the charge total before shipping.`;
  }
  return preamble;
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