/**
 * Wishlist Store
 *
 * Global state management for wishlist using Zustand
 * Includes localStorage persistence
 */

'use client';

import { create } from 'zustand';

export interface WishlistItem {
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
  inStock: boolean;
  addedAt: number;
}

interface WishlistStore {
  items: WishlistItem[];
  isLoading: boolean;

  // Actions
  addItem: (item: Omit<WishlistItem, 'id' | 'addedAt'>) => void;
  removeItem: (productId: string) => void;
  toggleItem: (item: Omit<WishlistItem, 'id' | 'addedAt'>) => boolean;
  clearWishlist: () => void;
  isInWishlist: (productId: string) => boolean;
  getItemCount: () => number;
  hydrate: () => void;
}

const STORAGE_KEY = 'maleq-wishlist';

// Persistence helpers
function persistWishlist(items: WishlistItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to persist wishlist:', error);
  }
}

function loadWishlist(): WishlistItem[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error('Failed to load wishlist:', error);
    return null;
  }
}

function clearPersistedWishlist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear wishlist:', error);
  }
}

/**
 * Wishlist Store
 */
export const useWishlistStore = create<WishlistStore>((set, get) => ({
  items: [],
  isLoading: false,

  /**
   * Add item to wishlist
   */
  addItem: (itemData) => {
    const state = get();
    const productId = itemData.productId;

    // Check if already in wishlist
    if (state.items.some((item) => item.productId === productId)) {
      return;
    }

    const newItem: WishlistItem = {
      ...itemData,
      id: `wishlist-${productId}`,
      addedAt: Date.now(),
    };

    const updatedItems = [...state.items, newItem];
    set({ items: updatedItems });
    persistWishlist(updatedItems);
  },

  /**
   * Remove item from wishlist
   */
  removeItem: (productId) => {
    const state = get();
    const updatedItems = state.items.filter((item) => item.productId !== productId);
    set({ items: updatedItems });
    persistWishlist(updatedItems);
  },

  /**
   * Toggle item in wishlist (add if not exists, remove if exists)
   * Returns true if item was added, false if removed
   */
  toggleItem: (itemData) => {
    const state = get();
    const productId = itemData.productId;
    const existingIndex = state.items.findIndex((item) => item.productId === productId);

    if (existingIndex >= 0) {
      // Remove item
      const updatedItems = state.items.filter((item) => item.productId !== productId);
      set({ items: updatedItems });
      persistWishlist(updatedItems);
      return false;
    } else {
      // Add item
      const newItem: WishlistItem = {
        ...itemData,
        id: `wishlist-${productId}`,
        addedAt: Date.now(),
      };
      const updatedItems = [...state.items, newItem];
      set({ items: updatedItems });
      persistWishlist(updatedItems);
      return true;
    }
  },

  /**
   * Clear all items from wishlist
   */
  clearWishlist: () => {
    set({ items: [] });
    clearPersistedWishlist();
  },

  /**
   * Check if product is in wishlist
   */
  isInWishlist: (productId) => {
    return get().items.some((item) => item.productId === productId);
  },

  /**
   * Get total item count
   */
  getItemCount: () => {
    return get().items.length;
  },

  /**
   * Hydrate wishlist from localStorage
   */
  hydrate: () => {
    if (typeof window === 'undefined') return;

    set({ isLoading: true });

    const savedItems = loadWishlist();

    if (savedItems) {
      set({
        items: savedItems,
        isLoading: false,
      });
    } else {
      set({ isLoading: false });
    }
  },
}));

/**
 * Hook to get wishlist item count
 */
export function useWishlistItemCount(): number {
  return useWishlistStore((state) => state.items.length);
}

/**
 * Hook to check if product is in wishlist
 */
export function useIsInWishlist(productId: string): boolean {
  return useWishlistStore((state) => state.isInWishlist(productId));
}
