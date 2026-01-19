/**
 * Recently Viewed Products Utility
 *
 * Tracks and retrieves recently viewed products using localStorage
 */

const STORAGE_KEY = 'maleq-recently-viewed';
const MAX_ITEMS = 10;

export interface RecentlyViewedItem {
  id: string;
  productId: string;
  name: string;
  slug: string;
  price: number;
  regularPrice?: number;
  image?: {
    url: string;
    altText: string;
  };
  viewedAt: number;
}

/**
 * Get all recently viewed products
 */
export function getRecentlyViewed(): RecentlyViewedItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];

    const items: RecentlyViewedItem[] = JSON.parse(saved);
    // Sort by most recently viewed
    return items.sort((a, b) => b.viewedAt - a.viewedAt);
  } catch (error) {
    console.error('Error loading recently viewed:', error);
    return [];
  }
}

/**
 * Add a product to recently viewed
 */
export function addToRecentlyViewed(item: Omit<RecentlyViewedItem, 'viewedAt'>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getRecentlyViewed();

    // Remove if already exists
    const filtered = current.filter((i) => i.productId !== item.productId);

    // Add new item at the beginning
    const newItem: RecentlyViewedItem = {
      ...item,
      viewedAt: Date.now(),
    };

    const updated = [newItem, ...filtered].slice(0, MAX_ITEMS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error saving recently viewed:', error);
  }
}

/**
 * Remove a product from recently viewed
 */
export function removeFromRecentlyViewed(productId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getRecentlyViewed();
    const updated = current.filter((i) => i.productId !== productId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error removing from recently viewed:', error);
  }
}

/**
 * Clear all recently viewed products
 */
export function clearRecentlyViewed(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing recently viewed:', error);
  }
}

/**
 * Check if a product is in recently viewed
 */
export function isRecentlyViewed(productId: string): boolean {
  const items = getRecentlyViewed();
  return items.some((i) => i.productId === productId);
}
