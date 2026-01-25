import { NextRequest, NextResponse } from 'next/server';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json(
        { error: 'Invalid customer ID' },
        { status: 400 }
      );
    }

    // Use our custom endpoint instead of WooCommerce REST API
    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/customer/${customerId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch customer');
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching customer:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch customer' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json(
        { error: 'Invalid customer ID' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Use our custom endpoint instead of WooCommerce REST API
    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/customer/${customerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to update customer');
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating customer:', error);

    const message = error instanceof Error ? error.message : 'Failed to update customer';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
