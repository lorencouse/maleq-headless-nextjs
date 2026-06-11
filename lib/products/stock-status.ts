/**
 * Canonical "can this be added to the cart?" check.
 *
 * LOW_STOCK items are still purchasable, so they count as in-stock. This used
 * to be inconsistent across the UI — ProductCard / QuickAddButton / variation
 * logic counted LOW_STOCK as buyable while QuickViewModal required a strict
 * IN_STOCK, so the same low-stock product was addable from a card but not from
 * quick view. Route all add-to-cart gating through this helper.
 */
export function isPurchasableStock(stockStatus: string | null | undefined): boolean {
  return stockStatus === 'IN_STOCK' || stockStatus === 'LOW_STOCK';
}
