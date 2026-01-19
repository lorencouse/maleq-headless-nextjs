/**
 * WooCommerce Order Management
 *
 * Functions for creating and managing orders via the WooCommerce REST API.
 */

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

export interface OrderLineItem {
  product_id: number;
  variation_id?: number;
  quantity: number;
  name?: string;
  sku?: string;
}

export interface OrderAddress {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

export interface CreateOrderData {
  payment_method: string;
  payment_method_title: string;
  set_paid: boolean;
  billing: OrderAddress;
  shipping: OrderAddress;
  line_items: OrderLineItem[];
  shipping_lines?: Array<{
    method_id: string;
    method_title: string;
    total: string;
  }>;
  meta_data?: Array<{
    key: string;
    value: string;
  }>;
  customer_note?: string;
  transaction_id?: string;
}

export interface WooCommerceOrder {
  id: number;
  parent_id: number;
  status: string;
  currency: string;
  date_created: string;
  date_modified: string;
  discount_total: string;
  shipping_total: string;
  total: string;
  total_tax: string;
  customer_id: number;
  order_key: string;
  billing: OrderAddress;
  shipping: OrderAddress;
  payment_method: string;
  payment_method_title: string;
  transaction_id: string;
  customer_note: string;
  line_items: Array<{
    id: number;
    name: string;
    product_id: number;
    variation_id: number;
    quantity: number;
    tax_class: string;
    subtotal: string;
    subtotal_tax: string;
    total: string;
    total_tax: string;
    sku: string;
    price: number;
    image: {
      id: number;
      src: string;
    };
  }>;
  shipping_lines: Array<{
    id: number;
    method_title: string;
    method_id: string;
    total: string;
    total_tax: string;
  }>;
  meta_data: Array<{
    id: number;
    key: string;
    value: string;
  }>;
}

/**
 * Create an order in WooCommerce
 */
export async function createOrder(orderData: CreateOrderData): Promise<WooCommerceOrder> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/orders`;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('WooCommerce order creation failed:', error);
    throw new Error(error.message || `Failed to create order: ${response.status}`);
  }

  return response.json();
}

/**
 * Get an order by ID
 */
export async function getOrder(orderId: number): Promise<WooCommerceOrder> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/orders/${orderId}`;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to get order: ${response.status}`);
  }

  return response.json();
}

/**
 * Update an order
 */
export async function updateOrder(
  orderId: number,
  updateData: Partial<CreateOrderData> & { status?: string }
): Promise<WooCommerceOrder> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/orders/${orderId}`;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify(updateData),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to update order: ${response.status}`);
  }

  return response.json();
}

/**
 * Get orders for a customer
 */
export async function getCustomerOrders(
  email: string,
  options: { per_page?: number; page?: number } = {}
): Promise<WooCommerceOrder[]> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const params = new URLSearchParams({
    search: email,
    per_page: String(options.per_page || 10),
    page: String(options.page || 1),
  });

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/orders?${params}`;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to get orders: ${response.status}`);
  }

  return response.json();
}
