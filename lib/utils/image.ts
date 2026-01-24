/**
 * Image utility functions for handling WordPress images
 */

/**
 * Default image base URL (production)
 * Used when NEXT_PUBLIC_IMAGE_BASE_URL is not set
 */
const DEFAULT_IMAGE_BASE_URL = 'https://www.maleq.com';

/**
 * Get the configured image base URL from environment
 */
function getImageBaseUrl(): string {
  return process.env.NEXT_PUBLIC_IMAGE_BASE_URL || DEFAULT_IMAGE_BASE_URL;
}

/**
 * Rewrites image URLs to use the configured image base URL
 * Extracts the path from any WordPress URL and prepends the environment-specific base
 *
 * @param url - The image URL from WordPress (any environment)
 * @returns The rewritten URL using the configured image base
 */
export function getProductionImageUrl(url: string | undefined): string {
  if (!url) return '';

  // Extract the path from the URL
  const path = getImagePath(url);

  // If we couldn't extract a path, return the original URL
  if (!path || path === url) return url;

  // Only rewrite WordPress media URLs (wp-content/uploads)
  if (!path.includes('/wp-content/')) return url;

  const baseUrl = getImageBaseUrl();

  return `${baseUrl}${path}`;
}

/**
 * Extracts the image path from a WordPress URL
 * Useful for debugging or additional processing
 *
 * @param url - The full image URL
 * @returns The path portion (e.g., /wp-content/uploads/2020/09/image.jpg)
 */
export function getImagePath(url: string | undefined): string {
  if (!url) return '';

  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    return url;
  }
}

/**
 * Process HTML content to fix relative image URLs
 * Converts /wp-content/uploads/... to full URLs using the image base
 *
 * @param html - The HTML content from WordPress
 * @returns HTML with absolute image URLs
 */
export function processContentImages(html: string | undefined): string {
  if (!html) return '';

  const baseUrl = getImageBaseUrl();

  // Replace relative wp-content URLs with absolute URLs
  // Matches src="/wp-content/..." and href="/wp-content/..."
  return html.replace(
    /(src|href)=(["'])(\/wp-content\/[^"']+)(["'])/gi,
    `$1=$2${baseUrl}$3$4`
  );
}

/**
 * Process HTML content to fix all WordPress URLs
 * - Converts relative image URLs to absolute
 * - Handles any remaining absolute URLs from old domains
 * - Cleans up WooCommerce verbose price text
 *
 * @param html - The HTML content from WordPress
 * @returns Processed HTML
 */
export function processWordPressContent(html: string | undefined): string {
  if (!html) return '';

  const baseUrl = getImageBaseUrl();
  let processed = html;

  // Replace relative wp-content URLs with absolute URLs
  processed = processed.replace(
    /(src|href)=(["'])(\/wp-content\/[^"']+)(["'])/gi,
    `$1=$2${baseUrl}$3$4`
  );

  // Also handle any remaining old domain URLs for wp-content
  const oldDomains = [
    'http://maleq-local.local',
    'https://maleq-local.local',
    'http://staging.maleq.com',
    'https://staging.maleq.com',
  ];

  for (const oldDomain of oldDomains) {
    processed = processed.replace(
      new RegExp(oldDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(/wp-content/[^"\'<>\\s]+)', 'gi'),
      baseUrl + '$1'
    );
  }

  // Replace WooCommerce add-to-cart shortcode output with custom placeholder
  // Product data is fetched via API using the product ID
  // Match <p class="product woocommerce...">...</p> blocks specifically
  // Use [\s\S] instead of . with s flag for ES2017 compatibility
  processed = processed.replace(
    /<p\s+class="product woocommerce[^"]*"[^>]*>([\s\S]+?)<\/p>/g,
    (match, innerContent) => {
      const productIdMatch = innerContent.match(/data-product_id="(\d+)"/);

      // If no product ID found, return original
      if (!productIdMatch) return match;

      const productId = productIdMatch[1];
      return `<div class="blog-add-to-cart-placeholder" data-product-id="${productId}"></div>`;
    }
  );

  return processed;
}
