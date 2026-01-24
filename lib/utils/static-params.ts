/**
 * Static Params Utilities
 *
 * Helpers for optimizing static generation during development.
 * In development, limits the number of pages generated to speed up builds.
 * In production, generates all pages.
 */

/**
 * Default limits for different content types in development
 */
export const DEV_LIMITS = {
  products: 10,
  categories: 10,
  brands: 10,
  blogPosts: 5,
  blogCategories: 5,
  blogTags: 5,
} as const;

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if we should limit static params
 * Can be overridden with GENERATE_ALL_PAGES=true
 */
export function shouldLimitParams(): boolean {
  if (process.env.GENERATE_ALL_PAGES === 'true') {
    return false;
  }
  return isDevelopment();
}

/**
 * Limit an array of static params for development builds
 *
 * @param params - Array of params to limit
 * @param limit - Maximum number of params (default: 10)
 * @returns Empty array in dev (unless GENERATE_ALL_PAGES=true), full array in production
 *
 * @example
 * // In generateStaticParams:
 * const slugs = await getAllProductSlugs();
 * return limitStaticParams(
 *   slugs.map(slug => ({ slug })),
 *   DEV_LIMITS.products
 * );
 */
export function limitStaticParams<T>(params: T[], limit: number = 10): T[] {
  // In development, return empty array to skip static generation entirely
  // Pages will be generated on-demand instead
  if (shouldLimitParams()) {
    return [];
  }
  return params;
}

/**
 * Log static params generation info (only in development)
 */
export function logStaticParamsInfo(type: string, total: number, generated: number): void {
  if (isDevelopment()) {
    if (total !== generated) {
      console.log(
        `[Static Params] ${type}: Generating ${generated}/${total} pages (dev mode)`
      );
    } else {
      console.log(`[Static Params] ${type}: Generating all ${total} pages`);
    }
  }
}
