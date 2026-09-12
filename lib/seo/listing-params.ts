/**
 * Shared helpers for paginated / filterable listing pages (category, brand,
 * shop, guides). Keeps the `?page=N` contract and the "which query params are
 * filters" list in one place so metadata (canonical, noindex) and rendering
 * agree.
 *
 * SEO rules encoded here (audit 2026-09-12, findings C3 + H7):
 *  - Page 1 is the bare URL; `?page=1` canonicalises to it.
 *  - Pages 2+ are indexable with a self-referencing canonical, so crawlers can
 *    walk the whole catalog through real <a href> links.
 *  - Any facet/sort param makes the URL a duplicate of the clean listing —
 *    those get `noindex, follow` (canonical alone is only a hint).
 */

export type UrlParams = { [key: string]: string | string[] | undefined };

/** Query params that change WHICH products are listed (facets/sort/search). */
export const LISTING_FILTER_KEYS = [
  'q',
  'category',
  'brand',
  'color',
  'material',
  'volume',
  'minPrice',
  'maxPrice',
  'minLength',
  'maxLength',
  'minWeight',
  'maxWeight',
  'inStock',
  'onSale',
  'productType',
  'sort',
  'browse',
] as const;

/** Parse `?page=` into a 1-based integer (invalid/missing → 1). */
export function parsePage(params: UrlParams): number {
  const raw = typeof params.page === 'string' ? params.page : undefined;
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** True when any facet/sort/search param is present. */
export function hasListingFilters(params: UrlParams): boolean {
  return LISTING_FILTER_KEYS.some((k) => {
    const v = params[k];
    return typeof v === 'string' ? v !== '' : Array.isArray(v) && v.length > 0;
  });
}

/**
 * Canonical path for a listing page: bare path on page 1, `?page=N` after.
 * Filter params are deliberately dropped — filtered URLs canonicalise to the
 * unfiltered listing (and are noindexed via `listingRobots`).
 */
export function listingCanonical(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

/** `robots` metadata for a listing URL. */
export function listingRobots(params: UrlParams): { index: boolean; follow: boolean } | undefined {
  return hasListingFilters(params) ? { index: false, follow: true } : undefined;
}

/** Only the string-valued params, for building pagination hrefs. */
export function stringParams(params: UrlParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/** Base64 `offset:N` cursor understood by getFilteredProducts / getBlogPosts. */
export function offsetCursor(offset: number): string | undefined {
  return offset > 0 ? Buffer.from(`offset:${offset}`).toString('base64') : undefined;
}

/** Total page count from a known total, or undefined when unknown. */
export function totalPagesFor(total: number | undefined, perPage: number): number | undefined {
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.ceil(total / perPage);
}
