import { NextRequest, NextResponse } from 'next/server';
import {
  createOrder,
  getOrder,
  upsertOrderMeta,
  CreateOrderData,
  OrderLineItem,
  OrderAddress,
} from '@/lib/woocommerce/orders';
import { getStripeServer } from '@/lib/stripe/server';
import { errorResponse, handleApiError, validationError } from '@/lib/api/response';
import { z } from 'zod';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';
import { extractAuthToken } from '@/lib/api/auth-token';
import {
  CheckoutPricingError,
  computeAuthoritativeCheckoutPricing,
} from '@/lib/checkout/server-pricing';
import { processWarehouseFulfillment } from '@/lib/fulfillment/service';

/**
 * Create Order API Route
 *
 * Creates an order in WooCommerce after successful payment.
 */

const addressSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  company: z.string().max(200).optional(),
  address1: z.string().min(1, 'Address is required').max(500),
  address2: z.string().max(500).optional(),
  city: z.string().min(1, 'City is required').max(200),
  state: z.string().min(1, 'State is required').max(100),
  zipCode: z.string().min(1, 'ZIP code is required').max(20),
  country: z.string().min(2, 'Country is required').max(2),
});

const orderRequestSchema = z.object({
  paymentIntentId: z.string().min(1).startsWith('pi_'),
  customerId: z.number().int().positive().optional(),
  contact: z.object({
    email: z.string().email('Valid email is required'),
    phone: z.string().max(30).optional(),
  }),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(),
  shippingMethod: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().min(0).optional(),
  }),
  cartItems: z.array(z.object({
    productId: z.string().min(1),
    variationId: z.string().optional(),
    quantity: z.number().int().min(1).max(100),
    name: z.string().min(1).max(500),
    sku: z.string().max(100),
  })).min(1, 'Cart cannot be empty'),
  totals: z.object({
    subtotal: z.number().min(0),
    shipping: z.number().min(0),
    tax: z.number().min(0),
    discount: z.number().min(0),
    total: z.number().min(0.01, 'Order total must be greater than zero'),
  }),
  couponCode: z.string().max(100).optional(),
  customerNote: z.string().max(2000).optional(),
});

export type CreateOrderRequest = z.infer<typeof orderRequestSchema>;

export interface CreateOrderResponse {
  orderId: number;
  orderKey: string;
  status: string;
  total: string;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestMeta = getRequestMeta(request);
  let rawBody: Record<string, unknown> | undefined;
  try {
    rawBody = await request.json();

    // Validate request body
    const parseResult = orderRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join('.');
        fieldErrors[path] = issue.message;
      }
      await logDurableEvent({
        eventType: 'checkout_order_validation_failed',
        severity: 'warning',
        message: 'Order creation request failed validation',
        ...requestMeta,
        payload: {
          issueCount: parseResult.error.issues.length,
          fields: Object.keys(fieldErrors).slice(0, 20),
        },
      });
      return validationError(fieldErrors);
    }

    const {
      paymentIntentId,
      customerId,
      contact,
      shippingAddress,
      billingAddress,
      shippingMethod,
      cartItems,
      totals,
      couponCode,
      customerNote,
    } = parseResult.data;

    // If a customerId is provided, require a bearer token and enforce ownership.
    if (customerId) {
      const tokenData = extractAuthToken(request);
      if (!tokenData) {
        return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      }
      if (tokenData.userId !== customerId) {
        return errorResponse('Forbidden', 403, 'FORBIDDEN');
      }
    }

    const pricing = await computeAuthoritativeCheckoutPricing({
      cartItems,
      shippingMethodId: shippingMethod.id,
      shippingCountry: shippingAddress.country,
      enforceStockChecks: false,
    });

    const totalsDelta = Math.abs(totals.total - pricing.total);
    if (totalsDelta > 0.01) {
      await logDurableEvent({
        eventType: 'checkout_order_total_mismatch',
        severity: 'warning',
        message: 'Order creation proceeding with authoritative server total',
        ...requestMeta,
        payload: {
          clientTotal: totals.total,
          authoritativeTotal: pricing.total,
          delta: Number(totalsDelta.toFixed(2)),
          paymentIntentId,
        },
      });
    }

    // Verify the payment intent
    const stripe = getStripeServer();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      await logDurableEvent({
        eventType: 'checkout_order_payment_incomplete',
        severity: 'warning',
        message: `Rejected order creation: payment intent ${paymentIntentId} not succeeded`,
        paymentIntentId,
        ...requestMeta,
        payload: {
          paymentStatus: paymentIntent.status,
          durationMs: Date.now() - startedAt,
        },
      });
      return errorResponse('Payment has not been completed', 400, 'PAYMENT_INCOMPLETE');
    }

    // Check for duplicate order - if this paymentIntentId already has an order, return it
    const existingOrderId = paymentIntent.metadata?.woocommerce_order_id;
    if (existingOrderId) {
      try {
        const existingOrder = await getOrder(parseInt(existingOrderId, 10));
        if (existingOrder) {
          await logDurableEvent({
            eventType: 'checkout_order_duplicate_payment_intent',
            message: `Reused existing order ${existingOrder.id} for payment intent`,
            paymentIntentId,
            orderId: existingOrder.id,
            ...requestMeta,
            payload: { durationMs: Date.now() - startedAt },
          });
          return NextResponse.json({
            orderId: existingOrder.id,
            orderKey: existingOrder.order_key,
            status: existingOrder.status,
            total: existingOrder.total,
          });
        }
      } catch {
        // Order lookup failed - continue with creation
        console.warn(`Duplicate check: order ${existingOrderId} not found, creating new order`);
      }
    }

    // Verify the amount matches - reject mismatches to prevent incorrect charges
    const expectedAmount = Math.round(pricing.total * 100);
    if (paymentIntent.amount !== expectedAmount) {
      console.error(`Payment amount mismatch: expected ${expectedAmount}, got ${paymentIntent.amount}`);
      sendAdminAlert('Amount Mismatch on Order Creation', {
        'PaymentIntent': paymentIntentId,
        'Expected (cents)': expectedAmount,
        'Actual (cents)': paymentIntent.amount,
        'Customer Email': contact.email,
      });
      await logDurableEvent({
        eventType: 'checkout_order_amount_mismatch',
        severity: 'warning',
        message: 'Payment amount mismatch during order creation',
        paymentIntentId,
        ...requestMeta,
        payload: {
          expectedAmountCents: expectedAmount,
          actualAmountCents: paymentIntent.amount,
          authoritativeTotal: pricing.total,
          durationMs: Date.now() - startedAt,
        },
      });
      return errorResponse(
        'Order total has changed since payment was initiated. Please try again.',
        400,
        'AMOUNT_MISMATCH'
      );
    }

    // Convert addresses to WooCommerce format
    const shipping: OrderAddress = {
      first_name: shippingAddress.firstName,
      last_name: shippingAddress.lastName,
      company: shippingAddress.company || '',
      address_1: shippingAddress.address1,
      address_2: shippingAddress.address2 || '',
      city: shippingAddress.city,
      state: shippingAddress.state,
      postcode: shippingAddress.zipCode,
      country: shippingAddress.country,
      phone: contact.phone || '',
    };

    const billing: OrderAddress = billingAddress
      ? {
          first_name: billingAddress.firstName,
          last_name: billingAddress.lastName,
          company: billingAddress.company || '',
          address_1: billingAddress.address1,
          address_2: billingAddress.address2 || '',
          city: billingAddress.city,
          state: billingAddress.state,
          postcode: billingAddress.zipCode,
          country: billingAddress.country,
          email: contact.email,
          phone: contact.phone || '',
        }
      : {
          ...shipping,
          email: contact.email,
        };

    // Convert cart items to WooCommerce format
    const lineItems: OrderLineItem[] = cartItems.map((item) => ({
      product_id: parseInt(item.productId, 10),
      variation_id: item.variationId ? parseInt(item.variationId, 10) : undefined,
      quantity: item.quantity,
      name: item.name,
      sku: item.sku,
    }));

    // Build the order data
    const orderData: CreateOrderData = {
      payment_method: 'stripe',
      payment_method_title: 'Credit Card (Stripe)',
      set_paid: true,
      ...(customerId && { customer_id: customerId }),
      billing,
      shipping,
      line_items: lineItems,
      shipping_lines: [
        {
          method_id: pricing.shippingMethod.id,
          method_title: pricing.shippingMethod.name,
          total: pricing.shipping.toFixed(2),
        },
      ],
      transaction_id: paymentIntentId,
      meta_data: [
        { key: '_stripe_payment_intent_id', value: paymentIntentId },
        { key: '_order_source', value: 'maleq-headless' },
        { key: '_checkout_subtotal', value: pricing.subtotal.toFixed(2) },
        { key: '_checkout_shipping', value: pricing.shipping.toFixed(2) },
        { key: '_checkout_discount', value: pricing.discount.toFixed(2) },
        { key: '_checkout_total', value: pricing.total.toFixed(2) },
      ],
      ...(customerNote && { customer_note: customerNote }),
    };

    // Add coupon if present
    if (couponCode) {
      orderData.meta_data?.push({ key: '_coupon_code', value: couponCode });
    }

    // Create the order in WooCommerce
    const order = await createOrder(orderData);

    // Store order ID in PaymentIntent metadata so the webhook can find it
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { woocommerce_order_id: String(order.id) },
    });

    let fulfillmentSummary:
      | {
          status: string;
          strategy: string;
          williams: { attempted: boolean; success: boolean; reference: string | null; error: string | null };
          stc: { attempted: boolean; success: boolean; reference: string | null; error: string | null };
          backorderedCount: number;
        }
      | null = null;

    try {
      const fulfillment = await processWarehouseFulfillment({
        orderId: order.id,
        paymentIntentId,
        contact,
        shippingAddress,
        shippingMethod: {
          id: shippingMethod.id,
          name: shippingMethod.name,
        },
        cartItems,
        customerNote,
      });

      await upsertOrderMeta(order.id, fulfillment.meta);

      fulfillmentSummary = {
        status: fulfillment.result.status,
        strategy: fulfillment.result.plan.strategy,
        williams: fulfillment.result.williams,
        stc: fulfillment.result.stc,
        backorderedCount: fulfillment.result.plan.backorderedLines.length,
      };

      if (
        fulfillment.result.status !== 'submitted' &&
        fulfillment.result.status !== 'unallocated'
      ) {
        sendAdminAlert('Warehouse Fulfillment Requires Attention', {
          'Order ID': order.id,
          'PaymentIntent': paymentIntentId,
          'Status': fulfillment.result.status,
          'Strategy': fulfillment.result.plan.strategy,
          'Williams Ref': fulfillment.result.williams.reference || 'N/A',
          'Williams Error': fulfillment.result.williams.error || 'None',
          'STC Ref': fulfillment.result.stc.reference || 'N/A',
          'STC Error': fulfillment.result.stc.error || 'None',
          'Backordered Items': fulfillment.result.plan.backorderedLines.length,
        });
      }

      await logDurableEvent({
        eventType: 'checkout_order_fulfillment_processed',
        message: `Processed warehouse fulfillment for order ${order.id}`,
        paymentIntentId,
        orderId: order.id,
        ...requestMeta,
        payload: fulfillmentSummary,
      });
    } catch (fulfillmentError) {
      const message =
        fulfillmentError instanceof Error
          ? fulfillmentError.message
          : String(fulfillmentError);

      sendAdminAlert('Warehouse Fulfillment Failed', {
        'Order ID': order.id,
        'PaymentIntent': paymentIntentId,
        'Customer Email': contact.email,
        'Error': message,
      });

      await logDurableEvent({
        eventType: 'checkout_order_fulfillment_failed',
        severity: 'error',
        message: `Warehouse fulfillment failed for order ${order.id}`,
        paymentIntentId,
        orderId: order.id,
        ...requestMeta,
        payload: { error: message },
      });
    }

    const response: CreateOrderResponse = {
      orderId: order.id,
      orderKey: order.order_key,
      status: order.status,
      total: order.total,
    };

    await logDurableEvent({
      eventType: 'checkout_order_created',
      message: `Created WooCommerce order ${order.id}`,
      paymentIntentId,
      orderId: order.id,
      ...requestMeta,
      payload: {
        itemCount: cartItems.length,
        total: pricing.total,
        subtotal: pricing.subtotal,
        shipping: pricing.shipping,
        discount: pricing.discount,
        couponApplied: Boolean(couponCode),
        customerId: customerId ?? null,
        fulfillment: fulfillmentSummary,
        durationMs: Date.now() - startedAt,
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CheckoutPricingError) {
      await logDurableEvent({
        eventType: 'checkout_order_pricing_error',
        severity: 'warning',
        message: error.message,
        ...requestMeta,
        payload: {
          code: error.code,
          durationMs: Date.now() - startedAt,
        },
      });
      return errorResponse(error.message, error.status, error.code);
    }

    const paymentIntentId =
      typeof rawBody?.paymentIntentId === 'string' ? rawBody.paymentIntentId : null;
    await logDurableEvent({
      eventType: 'checkout_order_create_failed',
      severity: 'error',
      message: 'Order creation failed',
      paymentIntentId,
      ...requestMeta,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    });
    sendAdminAlert('Order Creation Failed', {
      'PaymentIntent': (rawBody?.paymentIntentId as string) || 'N/A',
      'Customer Email': (rawBody?.contact as Record<string, string>)?.email || 'N/A',
      'Error': error instanceof Error ? error.message : String(error),
    });
    return handleApiError(error, 'Failed to create order');
  }
}

function getRequestMeta(request: NextRequest): {
  requestPath: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
} {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return {
    requestPath: request.nextUrl.pathname,
    ip,
    userAgent: request.headers.get('user-agent'),
    referrer: request.headers.get('referer'),
  };
}
