import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer, formatAmountForStripe } from '@/lib/stripe/server';
import { sendAdminAlert } from '@/lib/email/alert';

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
  let body: CreatePaymentIntentRequest | undefined;
  try {
    body = await request.json();

    const { amount, currency = 'usd', metadata, customerEmail, shippingAddress } = body!;

    // Validate amount
    if (!amount || amount <= 0) {
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

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating payment intent:', error);
    sendAdminAlert('PaymentIntent Creation Failed', {
      'Amount': `$${body?.amount || 'N/A'}`,
      'Customer Email': body?.customerEmail || 'N/A',
      'Error': error instanceof Error ? error.message : String(error),
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
