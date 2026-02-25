import { trackOrderSchema } from '@/lib/validations/tracking';
import {
  successResponse,
  validationError,
  errorResponse,
  handleApiError,
} from '@/lib/api/response';
import { getOrder } from '@/lib/woocommerce/orders';
import { isWooCommerceConfigured } from '@/lib/woocommerce/auth';
import {
  getWarehouseTrackingSummary,
  mergeTrackingEntries,
  warehouseShipmentsToTrackingEntries,
} from '@/lib/fulfillment/service';
import type { PublicTrackingEntry } from '@/lib/fulfillment/types';

function normalizeTrackingEntries(value: unknown): PublicTrackingEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: PublicTrackingEntry[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const number =
      typeof record.tracking_number === 'string'
        ? record.tracking_number.trim()
        : '';
    if (!number) continue;

    entries.push({
      tracking_provider:
        typeof record.tracking_provider === 'string'
          ? record.tracking_provider
          : 'Carrier',
      tracking_number: number,
      tracking_link:
        typeof record.tracking_link === 'string' ? record.tracking_link : '',
      date_shipped:
        typeof record.date_shipped === 'string'
          ? record.date_shipped
          : undefined,
    });
  }

  return entries;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = trackOrderSchema.safeParse(body);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path.join('.');
        errors[field] = issue.message;
      });
      return validationError(errors);
    }

    const { orderNumber, email } = result.data;

    const wpUrl = process.env.NEXT_PUBLIC_WORDPRESS_URL || process.env.WORDPRESS_URL
      || (process.env.NEXT_PUBLIC_WORDPRESS_API_URL || process.env.WORDPRESS_API_URL || '').replace(/\/graphql$/, '');
    if (!wpUrl) {
      return errorResponse('Service configuration error', 500);
    }

    const response = await fetch(`${wpUrl}/wp-json/maleq/v1/track-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_number: orderNumber,
        email,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.message || 'No order found. Please check your details.';
      return errorResponse(message, response.status);
    }

    const normalizedTracking = normalizeTrackingEntries(data.order?.tracking);
    let mergedTracking = normalizedTracking;
    let warehouseTracking: unknown = null;

    const numericOrderId = Number.parseInt(orderNumber, 10);
    if (!Number.isNaN(numericOrderId) && isWooCommerceConfigured()) {
      try {
        const wcOrder = await getOrder(numericOrderId);
        const orderEmail =
          typeof wcOrder.billing?.email === 'string'
            ? wcOrder.billing.email.toLowerCase().trim()
            : '';

        if (orderEmail && orderEmail === email.toLowerCase().trim()) {
          const summary = await getWarehouseTrackingSummary(wcOrder);
          const warehouseEntries = warehouseShipmentsToTrackingEntries(
            summary.shipments
          );
          mergedTracking = mergeTrackingEntries(
            normalizedTracking,
            warehouseEntries
          );
          warehouseTracking = summary;
        }
      } catch {
        // Keep primary tracking response as-is on enrichment failures.
      }
    }

    const enrichedOrder = {
      ...data.order,
      tracking: mergedTracking,
      ...(warehouseTracking ? { warehouse_tracking: warehouseTracking } : {}),
    };

    return successResponse(enrichedOrder);
  } catch (error) {
    return handleApiError(error, 'Failed to look up order');
  }
}
