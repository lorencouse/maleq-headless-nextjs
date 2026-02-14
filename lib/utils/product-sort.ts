import type { UnifiedProduct } from '@/lib/products/combined-service';

/**
 * Get source priority for a product.
 * Williams Trading / MUFFS products are prioritized over STC-only.
 */
function getSourcePriority(source?: string): number {
  if (!source) return 1;
  if (source === 'williams_trading' || source === 'MUFFS') return 0;
  if (source.includes('williams_trading')) return 1;
  if (source === 'stc') return 2;
  return 1;
}

/**
 * Sort products with in-stock items first, out-of-stock last.
 * Secondary sort by view count (popularity), then source priority.
 *
 * Note: Primary stock+source ordering is handled at the DB level by
 * the maleq-stock-priority.php mu-plugin. This client-side sort serves
 * as a fallback for search results (re-ranked after fetch) and user-selected sorts.
 */
export function sortProductsByPriority(products: UnifiedProduct[]): UnifiedProduct[] {
  return [...products].sort((a, b) => {
    const aInStock = a.stockStatus === 'IN_STOCK' ? 0 : 1;
    const bInStock = b.stockStatus === 'IN_STOCK' ? 0 : 1;
    if (aInStock !== bInStock) return aInStock - bInStock;

    // Sort by popularity score (views + sales*10 + reviews*10)
    const aPop = a.popularityScore ?? 0;
    const bPop = b.popularityScore ?? 0;
    if (aPop !== bPop) return bPop - aPop;

    const aSource = getSourcePriority(a.source);
    const bSource = getSourcePriority(b.source);
    return aSource - bSource;
  });
}

/**
 * Alias for sortProductsByPriority — used after explicit user sorts
 * (price, name, popularity) to push out-of-stock items to the end.
 */
export const sortWithOutOfStockLast = sortProductsByPriority;

/**
 * Filter out out-of-stock products entirely.
 * Used for carousels and recommendation sections.
 */
export function filterInStock(products: UnifiedProduct[]): UnifiedProduct[] {
  return products.filter(p => p.stockStatus === 'IN_STOCK');
}
