import { NextRequest, NextResponse } from 'next/server';
import { getCustomer } from '@/lib/woocommerce/customers';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Decode token to get customer ID
    // Token format: base64(customerId:timestamp:random)
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const [customerIdStr] = decoded.split(':');
      const customerId = parseInt(customerIdStr, 10);

      if (isNaN(customerId)) {
        return NextResponse.json(
          { error: 'Invalid token' },
          { status: 401 }
        );
      }

      // Fetch customer from WooCommerce
      const customer = await getCustomer(customerId);

      return NextResponse.json({
        user: {
          id: customer.id,
          email: customer.email,
          firstName: customer.first_name,
          lastName: customer.last_name,
          displayName: `${customer.first_name} ${customer.last_name}`,
          avatarUrl: customer.avatar_url,
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Auth check error:', error);

    return NextResponse.json(
      { error: 'Failed to verify authentication' },
      { status: 500 }
    );
  }
}
