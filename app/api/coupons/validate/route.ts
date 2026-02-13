import { NextRequest, NextResponse } from 'next/server';
import { wooClient } from '@/lib/woocommerce/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, cartTotal, productIds } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { valid: false, message: 'Coupon code is required' },
        { status: 400 }
      );
    }

    if (code.length > 100) {
      return NextResponse.json(
        { valid: false, message: 'Coupon code is too long' },
        { status: 400 }
      );
    }

    if (cartTotal === undefined || cartTotal < 0) {
      return NextResponse.json(
        { valid: false, message: 'Invalid cart total' },
        { status: 400 }
      );
    }

    if (Array.isArray(productIds) && productIds.length > 500) {
      return NextResponse.json(
        { valid: false, message: 'Too many product IDs' },
        { status: 400 }
      );
    }

    const result = await wooClient.validateCoupon(
      code.trim().toUpperCase(),
      cartTotal,
      productIds
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error validating coupon:', error);
    return NextResponse.json(
      { valid: false, message: 'Error validating coupon' },
      { status: 500 }
    );
  }
}
