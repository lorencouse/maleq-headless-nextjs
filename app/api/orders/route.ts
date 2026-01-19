import { NextRequest, NextResponse } from 'next/server';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customerId');
    const page = searchParams.get('page') || '1';
    const perPage = searchParams.get('per_page') || '10';

    if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
      throw new Error('WooCommerce API credentials not configured');
    }

    let url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/orders?page=${page}&per_page=${perPage}&orderby=date&order=desc`;

    if (customerId) {
      url += `&customer=${customerId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch orders: ${response.status}`);
    }

    const orders = await response.json();
    const total = response.headers.get('X-WP-Total');
    const totalPages = response.headers.get('X-WP-TotalPages');

    return NextResponse.json({
      orders,
      pagination: {
        total: total ? parseInt(total, 10) : 0,
        totalPages: totalPages ? parseInt(totalPages, 10) : 0,
        currentPage: parseInt(page, 10),
        perPage: parseInt(perPage, 10),
      },
    });
  } catch (error) {
    console.error('Error fetching orders:', error);

    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
