import { NextRequest, NextResponse } from 'next/server';
import { getCustomer, updateCustomer } from '@/lib/woocommerce/customers';

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

    const customer = await getCustomer(customerId);

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);

    return NextResponse.json(
      { error: 'Failed to fetch customer' },
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

    const customer = await updateCustomer(customerId, body);

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);

    const message = error instanceof Error ? error.message : 'Failed to update customer';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
