import { NextRequest, NextResponse } from 'next/server';

const WP_URL = process.env.NEXT_PUBLIC_WORDPRESS_URL || process.env.WORDPRESS_URL;

export async function POST(request: NextRequest) {
  try {
    const { productId } = await request.json();

    if (!productId || typeof productId !== 'number') {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const response = await fetch(`${WP_URL}/wp-json/maleq/v1/product-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to track view' }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
