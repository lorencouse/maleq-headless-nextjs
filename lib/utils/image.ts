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
