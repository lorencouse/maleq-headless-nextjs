import { NextRequest, NextResponse } from 'next/server';
import { createOrder, getOrder, CreateOrderData, OrderLineItem, OrderAddress } from '@/lib/woocommerce/orders';
import { getStripeServer } from '@/lib/stripe/server';
import { errorResponse, handleApiError, validationError } from '@/lib/api/response';
import { z } from 'zod';

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
  contact: z.object({
    email: z.string().email('Valid email is required'),
    phone: z.string().max(30).optional(),
  }),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(),
  shippingMethod: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().min(0),
  }),
  cartItems: z.array(z.object({
    productId: z.string().min(1),
    variationId: z.string().optional(),
    quantity: z.number().int().min(1).max(100),
    name: z.string().min(1),
    sku: z.string(),
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
  try {
    const rawBody = await request.json();

    // Validate request body
    const parseResult = orderRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join('.');
        fieldErrors[path] = issue.message;
      }
      return validationError(fieldErrors);
    }

    const {
      paymentIntentId,
      contact,
      shippingAddress,
      billingAddress,
      shippingMethod,
      cartItems,
      totals,
      couponCode,
      customerNote,
    } = parseResult.data;

    // Verify the payment intent
    const stripe = getStripeServer();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return errorResponse('Payment has not been completed', 400, 'PAYMENT_INCOMPLETE');
    }

    // Check for duplicate order - if this paymentIntentId already has an order, return it
    const existingOrderId = paymentIntent.metadata?.woocommerce_order_id;
    if (existingOrderId) {
      try {
        const existingOrder = await getOrder(parseInt(existingOrderId, 10));
        if (existingOrder) {
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
    const expectedAmount = Math.round(totals.total * 100);
    if (paymentIntent.amount !== expectedAmount) {
      console.error(`Payment amount mismatch: expected ${expectedAmount}, got ${paymentIntent.amount}`);
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
      billing,
      shipping,
      line_items: lineItems,
      shipping_lines: [
        {
          method_id: shippingMethod.id,
          method_title: shippingMethod.name,
          total: shippingMethod.price.toFixed(2),
        },
      ],
      transaction_id: paymentIntentId,
      meta_data: [
        { key: '_stripe_payment_intent_id', value: paymentIntentId },
        { key: '_order_source', value: 'maleq-headless' },
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

    const response: CreateOrderResponse = {
      orderId: order.id,
      orderKey: order.order_key,
      status: order.status,
      total: order.total,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error, 'Failed to create order');
  }
}
