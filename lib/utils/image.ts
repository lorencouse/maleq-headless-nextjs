/**
 * Image utility functions for handling WordPress images
 */
import { buildBlogAddToCartPlaceholder } from '@/lib/blog/add-to-cart-shortcode';

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

/** Known V2 app routes — links to these should NOT be prefixed with /guides/ */
const V2_APP_ROUTES = new Set([
  'account', 'forgot-password', 'reset-password', 'search', 'login', 'register',
  'about', 'contact', 'faq', 'terms', 'privacy', 'shipping-returns',
  'brands', 'brand', 'shop', 'guides', 'cart', 'checkout',
  'product', 'sex-toys', 'order-confirmation', 'track-order', 'admin',
  'api', 'graphql', '_next', 'images', 'fonts',
]);

/**
 * Process HTML content to fix all WordPress URLs
 * - Converts relative image URLs to absolute
 * - Handles any remaining absolute URLs from old domains
 * - Rewrites internal WordPress page links to V2 paths
 * - Cleans up WooCommerce verbose price text
 *
 * @param html - The HTML content from WordPress
 * @returns Processed HTML
 */
export function rewriteWordPressUrls(html: string | undefined): string {
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

  // --- Rewrite internal WordPress links to V2 paths ---

  // Convert absolute links with old domains to relative paths first
  // e.g. href="https://www.maleq.com/best-lubes/" → href="/best-lubes/"
  const domainPatterns = [
    'https?://(?:www\\.)?maleq\\.com',
    'https?://staging\\.maleq\\.com',
    'https?://maleq-local\\.local',
    'https?://wp\\.maleq\\.com',
  ];
  const domainRegex = new RegExp(
    `(href=["'])(${domainPatterns.join('|')})(\/[^"']*)(["'])`,
    'gi'
  );
  processed = processed.replace(domainRegex, '$1$3$4');

  // Rewrite old WordPress route patterns to V2 equivalents
  // /product-category/slug/ → /sex-toys/slug
  processed = processed.replace(
    /href=(["'])\/product-category\/([^"']+?)\/?["']/gi,
    'href=$1/sex-toys/$2$1'
  );

  // /category/slug/ → /guides/category/slug
  processed = processed.replace(
    /href=(["'])\/category\/([^"']+?)\/?["']/gi,
    'href=$1/guides/category/$2$1'
  );

  // /tag/slug/ → /guides/tag/slug
  processed = processed.replace(
    /href=(["'])\/tag\/([^"']+?)\/?["']/gi,
    'href=$1/guides/tag/$2$1'
  );

  // /my-account/ → /account
  processed = processed.replace(
    /href=(["'])\/my-account(\/[^"']*)?["']/gi,
    (_match, q) => `href=${q}/account${q}`
  );

  // Root-level blog slugs: href="/some-slug/" → href="/guides/some-slug"
  // Only rewrite if the first path segment is NOT a known V2 route
  processed = processed.replace(
    /href=(["'])\/([a-zA-Z0-9][a-zA-Z0-9-]*?)\/?["']/gi,
    (match, quote, slug) => {
      const firstSegment = slug.split('/')[0].toLowerCase();
      // Skip known V2 routes, wp-content, and product paths
      if (V2_APP_ROUTES.has(firstSegment) || firstSegment.startsWith('wp-')) {
        // Strip trailing slash but keep as-is
        return `href=${quote}/${slug.replace(/\/$/, '')}${quote}`;
      }
      return `href=${quote}/guides/${slug.replace(/\/$/, '')}${quote}`;
    }
  );

  // Replace WooCommerce add-to-cart shortcode output with custom placeholder
  // Product data is fetched via API using the product ID
  // WordPress wraps shortcode output in <p><p class="product woocommerce...">...</p></p>
  // We must match the outer <p> wrapper too, otherwise we get <p><div>...</div></p>
  // which is invalid HTML (div can't nest inside p) and breaks React hydration
  processed = processed.replace(
    /<p>\s*<p\s+class="product woocommerce[^"]*"[^>]*>([\s\S]+?)<\/p>\s*<\/p>/g,
    (match, innerContent) => {
      const productIdMatch = innerContent.match(/data-product_id="(\d+)"/);
      if (!productIdMatch) return match;
      const productId = productIdMatch[1];
      return buildBlogAddToCartPlaceholder(productId);
    }
  );

  // Fallback: match without outer <p> wrapper (in case some shortcodes aren't double-wrapped)
  processed = processed.replace(
    /<p\s+class="product woocommerce[^"]*"[^>]*>([\s\S]+?)<\/p>/g,
    (match, innerContent) => {
      const productIdMatch = innerContent.match(/data-product_id="(\d+)"/);
      if (!productIdMatch) return match;
      const productId = productIdMatch[1];
      return buildBlogAddToCartPlaceholder(productId);
    }
  );

  // UN-EXPANDED shortcodes: some posts deliver the add-to-cart as a Gutenberg
  // "Shortcode" block whose dynamic content WPGraphQL never ran through
  // do_shortcode/do_blocks, so it arrives as LITERAL text —
  //   <!-- wp:shortcode --> [add_to_cart id="123"] <!-- /wp:shortcode -->
  // The passes above only match WooCommerce's rendered output, so these would
  // otherwise show as raw `[add_to_cart id="123"]` text on the page. Convert
  // the literal shortcode (with or without the surrounding block comments)
  // straight to the placeholder div the client enhancer mounts into.
  // Tolerant of single/double quotes and extra attributes (e.g. sku/style).
  const ADD_TO_CART_SHORTCODE =
    /(?:<!--\s*wp:shortcode\s*-->)?\s*\[add_to_cart\b[^\]]*?\bid=["'](\d+)["'][^\]]*?\]\s*(?:<!--\s*\/wp:shortcode\s*-->)?/gi;
  processed = processed.replace(ADD_TO_CART_SHORTCODE, (_match, productId) =>
    buildBlogAddToCartPlaceholder(productId),
  );

  return processed;
}
