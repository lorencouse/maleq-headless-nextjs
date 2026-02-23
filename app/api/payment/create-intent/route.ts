import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer, formatAmountForStripe } from '@/lib/stripe/server';
import { sendAdminAlert } from '@/lib/email/alert';
import { logDurableEvent } from '@/lib/monitoring/durable-events';

/**
 * Create Payment Intent API Route
 *
 * Creates a Stripe PaymentIntent for the checkout process.
 * Returns the client secret needed to confirm the payment on the frontend.
 */

export interface CreatePaymentIntentRequest {
  amount: number; // Amount in dollars
  currency?: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  shippingAddress?: {
    name: string;
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
  };
}

export interface CreatePaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestMeta = getRequestMeta(request);
  let body: CreatePaymentIntentRequest | undefined;
  try {
    body = await request.json();

    const { amount, currency = 'usd', metadata, customerEmail, shippingAddress } = body!;

    // Validate amount
    if (!amount || amount <= 0) {
      await logDurableEvent({
        eventType: 'checkout_intent_invalid_amount',
        severity: 'warning',
        message: 'Rejected create-intent request with invalid amount',
        ...requestMeta,
        payload: { amount: amount ?? null, currency },
      });
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    // Create the PaymentIntent
    const stripe = getStripeServer();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: formatAmountForStripe(amount),
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        ...metadata,
        source: 'maleq-headless-checkout',
      },
      ...(customerEmail && { receipt_email: customerEmail }),
      ...(shippingAddress && { shipping: shippingAddress }),
    });

    if (!paymentIntent.client_secret) {
      throw new Error('Failed to create payment intent');
    }

    const response: CreatePaymentIntentResponse = {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };

    await logDurableEvent({
      eventType: 'checkout_intent_created',
      message: `Created payment intent ${paymentIntent.id}`,
      paymentIntentId: paymentIntent.id,
      ...requestMeta,
      payload: {
        amount,
        currency,
        hasCustomerEmail: Boolean(customerEmail),
        hasShippingAddress: Boolean(shippingAddress),
        durationMs: Date.now() - startedAt,
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating payment intent:', error);
    sendAdminAlert('PaymentIntent Creation Failed', {
      'Amount': `$${body?.amount || 'N/A'}`,
      'Customer Email': body?.customerEmail || 'N/A',
      'Error': error instanceof Error ? error.message : String(error),
    });
    await logDurableEvent({
      eventType: 'checkout_intent_failed',
      severity: 'error',
      message: 'Failed to create payment intent',
      ...requestMeta,
      payload: {
        amount: body?.amount ?? null,
        currency: body?.currency ?? 'usd',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    });

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
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
