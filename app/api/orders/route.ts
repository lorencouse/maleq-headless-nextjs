import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/lib/api/response';
import { parseIntSafe } from '@/lib/api/validation';
import { extractAuthToken } from '@/lib/api/auth-token';
import { getWooCommerceEndpoint, getAuthHeader, isWooCommerceConfigured } from '@/lib/woocommerce/auth';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerIdParam = searchParams.get('customerId');

    // Parse with bounds checking (page: min 1, perPage: 1-100)
    const page = parseIntSafe(searchParams.get('page'), 1, 1);
    const perPage = parseIntSafe(searchParams.get('per_page'), 10, 1, 100);

    // Require auth and enforce customer ownership
    const tokenData = extractAuthToken(request);
    if (!tokenData) {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }

    let customerId = tokenData.userId;
    if (customerIdParam) {
      const parsedCustomerId = parseInt(customerIdParam, 10);
      if (isNaN(parsedCustomerId) || parsedCustomerId <= 0) {
        return errorResponse('Invalid customer ID', 400, 'INVALID_CUSTOMER_ID');
      }
      if (parsedCustomerId !== tokenData.userId) {
        return errorResponse('Forbidden', 403, 'FORBIDDEN');
      }
      customerId = parsedCustomerId;
    }

    if (!isWooCommerceConfigured()) {
      return errorResponse('WooCommerce API credentials not configured', 500, 'CONFIG_ERROR');
    }

    const url = getWooCommerceEndpoint(
      `/orders?page=${page}&per_page=${perPage}&orderby=date&order=desc&customer=${customerId}`
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
      },
    });

    if (!response.ok) {
      return errorResponse(`Failed to fetch orders: ${response.status}`, response.status, 'WOOCOMMERCE_ERROR');
    }

    const orders = await response.json();

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
