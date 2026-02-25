import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/lib/api/response';
import { extractAuthToken } from '@/lib/api/auth-token';
import { getWooCommerceEndpoint, getAuthHeader, isWooCommerceConfigured } from '@/lib/woocommerce/auth';
import {
  getWarehouseTrackingSummary,
  mergeTrackingEntries,
  warehouseShipmentsToTrackingEntries,
} from '@/lib/fulfillment/service';

function normalizePrimaryTracking(
  trackingValue: unknown
): Array<{
  tracking_provider: string;
  tracking_number: string;
  tracking_link: string;
  date_shipped?: string;
}> {
  const entries: Array<{
    tracking_provider: string;
    tracking_number: string;
    tracking_link: string;
    date_shipped?: string;
  }> = [];

  if (Array.isArray(trackingValue)) {
    for (const item of trackingValue) {
      if (!item || typeof item !== 'object') continue;
      const value = item as Record<string, unknown>;
      const trackingNumber =
        typeof value.tracking_number === 'string'
          ? value.tracking_number.trim()
          : '';
      if (!trackingNumber) continue;
      entries.push({
        tracking_provider:
          typeof value.tracking_provider === 'string'
            ? value.tracking_provider
            : 'Carrier',
        tracking_number: trackingNumber,
        tracking_link:
          typeof value.tracking_link === 'string' ? value.tracking_link : '',
        date_shipped:
          typeof value.date_shipped === 'string'
            ? value.date_shipped
            : undefined,
      });
    }
  } else if (typeof trackingValue === 'string' && trackingValue.trim()) {
    entries.push({
      tracking_provider: 'Carrier',
      tracking_number: trackingValue.trim(),
      tracking_link: '',
    });
  }

  return entries;
}

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

    const primaryTrackingEntries = normalizePrimaryTracking(trackingMeta?.value);
    const warehouseTracking = await getWarehouseTrackingSummary(order);
    const warehouseEntries = warehouseShipmentsToTrackingEntries(
      warehouseTracking.shipments
    );
    const trackingShipments = mergeTrackingEntries(
      primaryTrackingEntries,
      warehouseEntries
    );
    const tracking = trackingShipments[0] || null;

    return NextResponse.json({
      success: true,
      order: {
        ...order,
        tracking,
        tracking_shipments: trackingShipments,
        warehouse_tracking: warehouseTracking,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch order');
  }
}
