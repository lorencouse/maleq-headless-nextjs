import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/lib/api/response';
import { extractAuthToken } from '@/lib/api/auth-token';
import { getWooCommerceEndpoint, getAuthHeader, isWooCommerceConfigured } from '@/lib/woocommerce/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);

    if (isNaN(orderId)) {
      return errorResponse('Invalid order ID', 400, 'INVALID_ID');
    }

    // Require auth for order access
    const tokenData = extractAuthToken(request);
    if (!tokenData) {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }

    if (!isWooCommerceConfigured()) {
      return errorResponse('WooCommerce API credentials not configured', 500, 'CONFIG_ERROR');
    }

    const url = getWooCommerceEndpoint(`/orders/${orderId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return errorResponse('Order not found', 404, 'NOT_FOUND');
      }
      return errorResponse(`Failed to fetch order: ${response.status}`, response.status, 'WOOCOMMERCE_ERROR');
    }

    const order = await response.json();

    // Enforce ownership: account-only route should only return caller's orders
    const orderCustomerId = Number(order.customer_id || 0);
    if (!orderCustomerId || orderCustomerId !== tokenData.userId) {
      return errorResponse('Forbidden', 403, 'FORBIDDEN');
    }

    // Extract tracking info from meta_data if available
    const trackingMeta = order.meta_data?.find(
      (meta: { key: string }) =>
        meta.key === '_wc_shipment_tracking_items' ||
        meta.key === 'tracking_number' ||
        meta.key === '_tracking_number'
    );

    let tracking = null;
    if (trackingMeta?.value) {
      // Handle different tracking data formats
      if (Array.isArray(trackingMeta.value) && trackingMeta.value.length > 0) {
        tracking = trackingMeta.value[0];
      } else if (typeof trackingMeta.value === 'string') {
        tracking = { tracking_number: trackingMeta.value };
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        ...order,
        tracking,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch order');
  }
}
