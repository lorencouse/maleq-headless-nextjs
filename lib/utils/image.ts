/**
 * Image utility functions for handling WordPress images
 */

/**
 * Rewrites staging image URLs to point to production server
 * This allows us to use production images without syncing them to staging
 *
 * @param url - The image URL from WordPress (may be staging or production)
 * @returns The rewritten URL pointing to production
 */
export function getProductionImageUrl(url: string | undefined): string {
  if (!url) return '';

  // If the URL is from staging.maleq.com, rewrite it to www.maleq.org
  // This allows us to load images from production without copying them
  if (url.includes('staging.maleq.com')) {
    return url.replace('staging.maleq.com', 'www.maleq.org');
  }

  // If already pointing to production, return as-is
  return url;
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
