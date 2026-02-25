export type WarehouseName = 'williams' | 'stc';

export interface FulfillmentAddress {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface FulfillmentContact {
  email: string;
  phone?: string;
}

export interface FulfillmentShippingMethod {
  id: string;
  name: string;
}

export interface FulfillmentCartItem {
  productId: string;
  variationId?: string;
  quantity: number;
  name: string;
  sku?: string;
}

export interface FulfillmentRequest {
  orderId: number;
  paymentIntentId: string;
  contact: FulfillmentContact;
  shippingAddress: FulfillmentAddress;
  shippingMethod: FulfillmentShippingMethod;
  cartItems: FulfillmentCartItem[];
  customerNote?: string;
}

export interface ResolvedFulfillmentItem {
  productId: number;
  variationId?: number;
  name: string;
  requestedQty: number;
  source: string;
  totalStock: number;
  williamsAvailable: number;
  stcAvailable: number;
  williamsSku: string | null;
  stcUpc: string | null;
}

export interface FulfillmentAllocationLine {
  productId: number;
  variationId?: number;
  name: string;
  requestedQty: number;
  williamsQty: number;
  stcQty: number;
  backorderedQty: number;
  williamsSku: string | null;
  stcUpc: string | null;
}

export type FulfillmentStrategy =
  | 'williams_only'
  | 'stc_only'
  | 'split'
  | 'unallocated';

export interface WarehouseSubmitLine {
  productId: number;
  variationId?: number;
  name: string;
  quantity: number;
  sku: string;
}

export interface FulfillmentPlan {
  strategy: FulfillmentStrategy;
  allocations: FulfillmentAllocationLine[];
  williamsLines: WarehouseSubmitLine[];
  stcLines: WarehouseSubmitLine[];
  backorderedLines: FulfillmentAllocationLine[];
}

export interface WarehouseSubmissionState {
  attempted: boolean;
  success: boolean;
  reference: string | null;
  error: string | null;
}

export interface FulfillmentSubmissionResult {
  status: 'submitted' | 'partial' | 'failed' | 'unallocated';
  plan: FulfillmentPlan;
  williams: WarehouseSubmissionState;
  stc: WarehouseSubmissionState;
}

export interface WarehouseTrackingShipment {
  warehouse: WarehouseName;
  reference: string;
  status: string;
  trackingNumber?: string;
  trackingCompany?: string;
  shippedAt?: string;
}

export interface WarehouseTrackingSummary {
  fulfillmentStatus: string | null;
  strategy: string | null;
  shipments: WarehouseTrackingShipment[];
  errors: Array<{ warehouse: WarehouseName; message: string }>;
}

export interface PublicTrackingEntry {
  tracking_provider: string;
  tracking_number: string;
  tracking_link: string;
  date_shipped?: string;
}
