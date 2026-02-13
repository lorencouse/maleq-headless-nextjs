import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/lib/api/response';
import { parseIntSafe } from '@/lib/api/validation';
import { getWooCommerceEndpoint, getAuthHeader, isWooCommerceConfigured } from '@/lib/woocommerce/auth';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customerId');
    const email = searchParams.get('email');

    // Parse with bounds checking (page: min 1, perPage: 1-100)
    const page = parseIntSafe(searchParams.get('page'), 1, 1);
    const perPage = parseIntSafe(searchParams.get('per_page'), 10, 1, 100);

    if (!isWooCommerceConfigured()) {
      return errorResponse('WooCommerce API credentials not configured', 500, 'CONFIG_ERROR');
    }

    let url = getWooCommerceEndpoint(`/orders?page=${page}&per_page=${perPage}&orderby=date&order=desc`);

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
      return errorResponse(`Failed to fetch orders: ${response.status}`, response.status, 'WOOCOMMERCE_ERROR');
    }

    let orders = await response.json();

    // If no orders found by customer ID but we have an email, search by email too
    // This catches guest orders placed before the customer_id fix
    if (orders.length === 0 && email) {
      const emailUrl = getWooCommerceEndpoint(`/orders?page=${page}&per_page=${perPage}&orderby=date&order=desc&search=${encodeURIComponent(email)}`);
      const emailResponse = await fetch(emailUrl, {
        method: 'GET',
        headers: {
          'Authorization': getAuthHeader(),
        },
      });
      if (emailResponse.ok) {
        orders = await emailResponse.json();
      }
    }

    const total = response.headers.get('X-WP-Total');
    const totalPages = response.headers.get('X-WP-TotalPages');

    return NextResponse.json({
      success: true,
      orders,
      pagination: {
        total: total ? parseInt(total, 10) : 0,
        totalPages: totalPages ? parseInt(totalPages, 10) : 0,
        currentPage: page,
        perPage: perPage,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch orders');
  }
}
