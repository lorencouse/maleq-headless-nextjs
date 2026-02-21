/**
 * WooCommerce Authentication Utilities
 *
 * Shared authentication helpers for WooCommerce REST API requests.
 * Uses auto-switching WordPress URL from lib/config/wp-env.ts.
 */

import { getWooCommerceUrl as getWpEnvWooUrl } from '@/lib/config/wp-env';

const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

/**
 * Get WooCommerce API base URL (auto-switches local/prod)
 */
export function getWooCommerceUrl(): string {
  return getWpEnvWooUrl();
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
  return !!(CONSUMER_KEY && CONSUMER_SECRET);
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
