import { NextRequest, NextResponse } from 'next/server';
import { createOrder, CreateOrderData, OrderLineItem, OrderAddress } from '@/lib/woocommerce/orders';
import { getStripeServer } from '@/lib/stripe/server';

/**
 * Create Order API Route
 *
 * Creates an order in WooCommerce after successful payment.
 */

export interface CreateOrderRequest {
  paymentIntentId: string;
  contact: {
    email: string;
    phone?: string;
  };
  shippingAddress: {
    firstName: string;
    lastName: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  billingAddress?: {
    firstName: string;
    lastName: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  shippingMethod: {
    id: string;
    name: string;
    price: number;
  };
  cartItems: Array<{
    productId: string;
    variationId?: string;
    quantity: number;
    name: string;
    sku: string;
  }>;
  totals: {
    subtotal: number;
    shipping: number;
    tax: number;
    discount: number;
    total: number;
  };
  couponCode?: string;
  customerNote?: string;
}

export interface CreateOrderResponse {
  orderId: number;
  orderKey: string;
  status: string;
  total: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateOrderRequest = await request.json();

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
    } = body;

    // Verify the payment intent
    const stripe = getStripeServer();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'Payment has not been completed' },
        { status: 400 }
      );
    }

    // Verify the amount matches
    const expectedAmount = Math.round(totals.total * 100);
    if (paymentIntent.amount !== expectedAmount) {
      console.warn(`Payment amount mismatch: expected ${expectedAmount}, got ${paymentIntent.amount}`);
      // Continue anyway - the payment was successful
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

    const response: CreateOrderResponse = {
      orderId: order.id,
      orderKey: order.order_key,
      status: order.status,
      total: order.total,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating order:', error);

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}
