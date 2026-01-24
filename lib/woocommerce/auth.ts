/**
 * WooCommerce Authentication Utilities
 *
 * Shared authentication helpers for WooCommerce REST API requests
 */

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

/**
 * Get WooCommerce API base URL
 */
export function getWooCommerceUrl(): string {
  if (!WOOCOMMERCE_URL) {
    throw new Error('WooCommerce URL not configured. Set WOOCOMMERCE_URL or NEXT_PUBLIC_WORDPRESS_API_URL environment variable.');
  }
  return WOOCOMMERCE_URL;
}

/**
 * Generate Basic Auth header for WooCommerce REST API
 */
export function getAuthHeader(): string {
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured. Set WOOCOMMERCE_CONSUMER_KEY and WOOCOMMERCE_CONSUMER_SECRET environment variables.');
  }
  return `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}`;
}

/**
 * Check if WooCommerce API credentials are configured
 */
export function isWooCommerceConfigured(): boolean {
  return !!(WOOCOMMERCE_URL && CONSUMER_KEY && CONSUMER_SECRET);
}

/**
 * Get WooCommerce REST API endpoint
 */
export function getWooCommerceEndpoint(path: string): string {
  const baseUrl = getWooCommerceUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}/wp-json/wc/v3${normalizedPath}`;
}

/**
 * Create headers for WooCommerce REST API requests
 */
export function getWooCommerceHeaders(): HeadersInit {
  return {
    'Authorization': getAuthHeader(),
    'Content-Type': 'application/json',
  };
}
