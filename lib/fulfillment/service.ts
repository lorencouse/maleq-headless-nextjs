import { buildFulfillmentPlan } from './allocation';
import type {
  FulfillmentCartItem,
  FulfillmentRequest,
  FulfillmentSubmissionResult,
  PublicTrackingEntry,
  ResolvedFulfillmentItem,
  WarehouseTrackingShipment,
  WarehouseTrackingSummary,
} from './types';
import {
  findWilliamsOrderById,
  getStcOrderStatus,
  isStcConfigured,
  isWilliamsConfigured,
  mapStcShippingMethod,
  mapWilliamsShippingMethod,
  submitStcOrder,
  submitWilliamsOrder,
} from './warehouse-clients';
import { wooClient } from '@/lib/woocommerce/client';
import type { WooProduct, WooProductVariation } from '@/lib/woocommerce/types';

export const FULFILLMENT_META_KEYS = {
  status: '_fulfillment_status',
  strategy: '_fulfillment_strategy',
  allocationsJson: '_fulfillment_allocations_json',
  backordersJson: '_fulfillment_backorders_json',
  williamsOrderId: '_fulfillment_williams_order_id',
  stcReference: '_fulfillment_stc_reference',
  lastError: '_fulfillment_last_error',
  updatedAt: '_fulfillment_updated_at',
} as const;

type MetaValue = unknown;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(Math.floor(value), 0);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(parsed, 0);
    }
  }
  return null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

function normalizeCountryForWilliams(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  if (normalized === 'US') return 'USA';
  return normalized;
}

function createMetaMap(
  parentMeta: Array<{ key: string; value: MetaValue }> = [],
  variationMeta: Array<{ key: string; value: MetaValue }> = []
): Map<string, MetaValue> {
  const map = new Map<string, MetaValue>();

  for (const entry of parentMeta) {
    if (entry?.key) map.set(entry.key, entry.value);
  }
  for (const entry of variationMeta) {
    if (entry?.key) map.set(entry.key, entry.value);
  }

  return map;
}

function parseSourceFlags(metaMap: Map<string, MetaValue>): {
  source: string;
  hasWilliams: boolean;
  hasStc: boolean;
} {
  const source =
    getString(metaMap.get('_product_source')) ||
    getString(metaMap.get('product_source')) ||
    '';
  const normalized = source.toLowerCase();

  const hasWilliams =
    normalized.includes('williams') ||
    normalized.includes('muffs') ||
    Boolean(getString(metaMap.get('_wt_sku'))) ||
    Boolean(getString(metaMap.get('_wt_barcode'))) ||
    getNumeric(metaMap.get('wt_stock_count')) !== null;

  let hasStc = normalized.includes('stc');

  if (!hasWilliams && !hasStc) {
    hasStc = true;
  }

  if (hasWilliams && !hasStc && normalized.includes(',')) {
    hasStc = normalized.split(',').some((token) => token.trim() === 'stc');
  }

  return { source, hasWilliams, hasStc };
}

function normalizeTrackingUrl(provider: string, trackingNumber: string): string {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;
  }
  if (normalizedProvider.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
  }
  if (normalizedProvider.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
  }
  if (normalizedProvider.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(trackingNumber)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(`${trackingNumber} tracking`)}`;
}

function uniqTrackingEntries(entries: PublicTrackingEntry[]): PublicTrackingEntry[] {
  const seen = new Set<string>();
  const output: PublicTrackingEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.tracking_provider.toLowerCase()}::${entry.tracking_number.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }

  return output;
}

async function resolveFulfillmentItem(
  item: FulfillmentCartItem,
  parentProduct: WooProduct,
  variationProduct: WooProductVariation | null
): Promise<ResolvedFulfillmentItem> {
  const productId = Number.parseInt(item.productId, 10);
  const variationId = item.variationId
    ? Number.parseInt(item.variationId, 10)
    : undefined;

  if (Number.isNaN(productId)) {
    throw new Error(`Invalid product ID in cart: ${item.productId}`);
  }

  const metaMap = createMetaMap(
    (parentProduct.meta_data || []) as Array<{ key: string; value: unknown }>,
    (variationProduct?.meta_data || []) as Array<{ key: string; value: unknown }>
  );

  const sku =
    getString(variationProduct?.sku) ||
    getString(parentProduct.sku) ||
    getString(metaMap.get('_wt_barcode')) ||
    getString(item.sku) ||
    null;

  const { source, hasWilliams, hasStc } = parseSourceFlags(metaMap);

  const totalStockRaw =
    getNumeric(variationProduct?.stock_quantity) ??
    getNumeric(parentProduct.stock_quantity) ??
    0;
  const totalStock = Math.max(totalStockRaw, 0);

  const wtStockMeta = getNumeric(metaMap.get('wt_stock_count'));
  let williamsAvailable = 0;
  if (hasWilliams) {
    if (wtStockMeta !== null) {
      williamsAvailable = Math.min(wtStockMeta, totalStock);
    } else if (!hasStc) {
      williamsAvailable = totalStock;
    } else {
      williamsAvailable = 0;
    }
  }

  let stcAvailable = 0;
  if (hasStc) {
    stcAvailable = hasWilliams
      ? Math.max(totalStock - williamsAvailable, 0)
      : totalStock;
  }

  const williamsSku =
    getString(metaMap.get('_wt_sku')) ||
    (hasWilliams ? sku : null);
  const stcUpc = hasStc ? sku : null;

  return {
    productId,
    variationId:
      variationId !== undefined && !Number.isNaN(variationId)
        ? variationId
        : undefined,
    name: item.name,
    requestedQty: item.quantity,
    source,
    totalStock,
    williamsAvailable,
    stcAvailable,
    williamsSku,
    stcUpc,
  };
}

async function resolveFulfillmentItems(
  cartItems: FulfillmentCartItem[]
): Promise<ResolvedFulfillmentItem[]> {
  const parentCache = new Map<number, Promise<WooProduct>>();

  const getParent = (productId: number): Promise<WooProduct> => {
    const existing = parentCache.get(productId);
    if (existing) return existing;
    const request = wooClient.getProductById(productId);
    parentCache.set(productId, request);
    return request;
  };

  return Promise.all(
    cartItems.map(async (item) => {
      const productId = Number.parseInt(item.productId, 10);
      if (Number.isNaN(productId)) {
        throw new Error(`Invalid product ID in cart: ${item.productId}`);
      }

      const parent = await getParent(productId);

      let variation: WooProductVariation | null = null;
      if (item.variationId) {
        const variationId = Number.parseInt(item.variationId, 10);
        if (!Number.isNaN(variationId)) {
          try {
            variation = await wooClient.getVariationById(productId, variationId);
          } catch {
            variation = null;
          }
        }
      }

      return resolveFulfillmentItem(item, parent, variation);
    })
  );
}

function buildFulfillmentMeta(
  result: FulfillmentSubmissionResult
): Record<string, unknown> {
  const latestError = [result.williams.error, result.stc.error]
    .filter(Boolean)
    .join(' | ');

  return {
    [FULFILLMENT_META_KEYS.status]: result.status,
    [FULFILLMENT_META_KEYS.strategy]: result.plan.strategy,
    [FULFILLMENT_META_KEYS.allocationsJson]: JSON.stringify(result.plan.allocations),
    [FULFILLMENT_META_KEYS.backordersJson]: JSON.stringify(result.plan.backorderedLines),
    [FULFILLMENT_META_KEYS.williamsOrderId]: result.williams.reference || '',
    [FULFILLMENT_META_KEYS.stcReference]: result.stc.reference || '',
    [FULFILLMENT_META_KEYS.lastError]: latestError,
    [FULFILLMENT_META_KEYS.updatedAt]: new Date().toISOString(),
  };
}

function getMetaValueByKey(
  metaData: Array<{ key?: string; value?: unknown }> | undefined,
  key: string
): unknown {
  const entry = metaData?.find((item) => item?.key === key);
  return entry?.value;
}

function mapStcShipments(
  reference: string,
  payload: unknown
): WarehouseTrackingShipment[] {
  const root = asRecord(payload);
  if (!root) return [];

  const status = getString(root.status) || 'unknown';
  const submittedAt = getString(root.submitted_timestamp) || undefined;
  const shippedAt = status.toLowerCase().includes('ship')
    ? submittedAt
    : undefined;
  const details = Array.isArray(root.shipment_details)
    ? root.shipment_details
    : [];

  return details
    .map((detail) => asRecord(detail))
    .filter((detail): detail is Record<string, unknown> => Boolean(detail))
    .map((detail) => {
      const trackingNumber = getString(detail.tracking_number) || undefined;
      const trackingCompany = getString(detail.tracking_company) || undefined;
      return {
        warehouse: 'stc' as const,
        reference,
        status,
        trackingNumber,
        trackingCompany,
        shippedAt,
      };
    });
}

function mapWilliamsShipments(
  reference: string,
  payload: unknown
): WarehouseTrackingShipment[] {
  const root = asRecord(payload);
  if (!root) return [];

  const shipping = asRecord(root.shipping) || {};
  const trackingNumber =
    getString(shipping.tracking_number) ||
    getString(root.tracking_number) ||
    undefined;
  const trackingCompany =
    getString(shipping.shipper) || getString(root.shipper) || 'Williams Trading';
  const shippedAt =
    getString(shipping.shipping_date) || getString(root.changed) || undefined;

  const status = toBoolean(root.canceled)
    ? 'canceled'
    : toBoolean(root.shipped)
      ? 'shipped'
      : toBoolean(root.processed)
        ? 'processing'
        : 'submitted';

  return [
    {
      warehouse: 'williams',
      reference,
      status,
      trackingNumber,
      trackingCompany,
      shippedAt,
    },
  ];
}

function normalizeFulfillmentStatus(
  result: FulfillmentSubmissionResult
): FulfillmentSubmissionResult['status'] {
  const anySubmissionSuccess = result.williams.success || result.stc.success;
  const hasBackorders = result.plan.backorderedLines.length > 0;
  const anyAttempted = result.williams.attempted || result.stc.attempted;

  if (!anyAttempted) return 'unallocated';
  if (!anySubmissionSuccess) return hasBackorders ? 'failed' : 'unallocated';
  if (hasBackorders || !result.williams.success || !result.stc.success) {
    return 'partial';
  }
  return 'submitted';
}

export async function processWarehouseFulfillment(
  request: FulfillmentRequest
): Promise<{
  result: FulfillmentSubmissionResult;
  meta: Record<string, unknown>;
}> {
  const resolvedItems = await resolveFulfillmentItems(request.cartItems);
  const plan = buildFulfillmentPlan(resolvedItems, {
    enableWilliams: isWilliamsConfigured(),
    enableStc: isStcConfigured(),
  });

  const baseRef = `MQ-${request.orderId}`;
  const williamsSubmission: FulfillmentSubmissionResult['williams'] = {
    attempted: plan.williamsLines.length > 0,
    success: false,
    reference: null,
    error: null,
  };
  const stcSubmission: FulfillmentSubmissionResult['stc'] = {
    attempted: plan.stcLines.length > 0,
    success: false,
    reference: null,
    error: null,
  };

  const tasks: Promise<void>[] = [];

  if (plan.williamsLines.length > 0) {
    if (!isWilliamsConfigured()) {
      williamsSubmission.error = 'Williams credentials are not configured';
    } else {
      tasks.push(
        (async () => {
          try {
            const payload = {
              first_name: request.shippingAddress.firstName,
              last_name: request.shippingAddress.lastName,
              address1: request.shippingAddress.address1,
              address2: request.shippingAddress.address2 || '',
              city: request.shippingAddress.city,
              state: request.shippingAddress.state,
              zip: request.shippingAddress.zipCode,
              country: normalizeCountryForWilliams(request.shippingAddress.country),
              email: request.contact.email,
              phone1: request.contact.phone || '',
              shipping_method: mapWilliamsShippingMethod(request.shippingMethod),
              notes: request.customerNote || '',
              reference: baseRef,
              reference2: String(request.orderId),
              reference3: request.paymentIntentId,
              products: plan.williamsLines.map((line) => ({
                sku: line.sku,
                quantity: line.quantity,
              })),
            };

            const response = await submitWilliamsOrder(payload);
            williamsSubmission.success = true;
            williamsSubmission.reference = response.providerOrderId || baseRef;
          } catch (error) {
            williamsSubmission.error =
              error instanceof Error ? error.message : String(error);
          }
        })()
      );
    }
  }

  if (plan.stcLines.length > 0) {
    if (!isStcConfigured()) {
      stcSubmission.error = 'STC credentials are not configured';
    } else {
      tasks.push(
        (async () => {
          try {
            const stcReference = `${baseRef}-STC`;
            const payload = {
              order: {
                shippingAddress: {
                  firstName: request.shippingAddress.firstName,
                  lastName: request.shippingAddress.lastName,
                  companyName: request.shippingAddress.company || '',
                  address1: request.shippingAddress.address1,
                  address2: request.shippingAddress.address2 || '',
                  city: request.shippingAddress.city,
                  province: request.shippingAddress.state,
                  country: request.shippingAddress.country,
                  zip: request.shippingAddress.zipCode,
                  phoneNumber: request.contact.phone || '',
                },
                lineItems: plan.stcLines.map((line) => ({
                  upc: line.sku,
                  quantity: line.quantity,
                })),
                shippingMethod: mapStcShippingMethod(
                  request.shippingMethod,
                  request.shippingAddress.country
                ),
                internalReferenceNumber: stcReference,
              },
            };

            await submitStcOrder(payload);
            stcSubmission.success = true;
            stcSubmission.reference = stcReference;
          } catch (error) {
            stcSubmission.error =
              error instanceof Error ? error.message : String(error);
          }
        })()
      );
    }
  }

  await Promise.all(tasks);

  const result: FulfillmentSubmissionResult = {
    status: 'unallocated',
    plan,
    williams: williamsSubmission,
    stc: stcSubmission,
  };
  result.status = normalizeFulfillmentStatus(result);

  return {
    result,
    meta: buildFulfillmentMeta(result),
  };
}

export async function getWarehouseTrackingSummary(order: {
  meta_data?: Array<{ key?: string; value?: unknown }>;
}): Promise<WarehouseTrackingSummary> {
  const fulfillmentStatus = getString(
    getMetaValueByKey(order.meta_data, FULFILLMENT_META_KEYS.status)
  );
  const strategy = getString(
    getMetaValueByKey(order.meta_data, FULFILLMENT_META_KEYS.strategy)
  );
  const williamsOrderId = getString(
    getMetaValueByKey(order.meta_data, FULFILLMENT_META_KEYS.williamsOrderId)
  );
  const stcReference = getString(
    getMetaValueByKey(order.meta_data, FULFILLMENT_META_KEYS.stcReference)
  );

  const shipments: WarehouseTrackingShipment[] = [];
  const errors: WarehouseTrackingSummary['errors'] = [];

  const tasks: Promise<void>[] = [];

  if (williamsOrderId && isWilliamsConfigured()) {
    tasks.push(
      (async () => {
        try {
          const statusPayload = await findWilliamsOrderById(williamsOrderId);
          shipments.push(...mapWilliamsShipments(williamsOrderId, statusPayload));
        } catch (error) {
          errors.push({
            warehouse: 'williams',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })()
    );
  }

  if (stcReference && isStcConfigured()) {
    tasks.push(
      (async () => {
        try {
          const statusPayload = await getStcOrderStatus(stcReference);
          shipments.push(...mapStcShipments(stcReference, statusPayload));
        } catch (error) {
          errors.push({
            warehouse: 'stc',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })()
    );
  }

  await Promise.all(tasks);

  return {
    fulfillmentStatus,
    strategy,
    shipments,
    errors,
  };
}

export function warehouseShipmentsToTrackingEntries(
  shipments: WarehouseTrackingShipment[]
): PublicTrackingEntry[] {
  const entries = shipments
    .filter((shipment) => shipment.trackingNumber)
    .map((shipment) => {
      const trackingNumber = shipment.trackingNumber as string;
      const provider =
        shipment.trackingCompany ||
        (shipment.warehouse === 'stc' ? 'STC Warehouse' : 'Williams Trading');

      return {
        tracking_provider: provider,
        tracking_number: trackingNumber,
        tracking_link: normalizeTrackingUrl(provider, trackingNumber),
        date_shipped: shipment.shippedAt,
      };
    });

  return uniqTrackingEntries(entries);
}

export function mergeTrackingEntries(
  primary: PublicTrackingEntry[],
  warehouseEntries: PublicTrackingEntry[]
): PublicTrackingEntry[] {
  return uniqTrackingEntries([...primary, ...warehouseEntries]);
}
