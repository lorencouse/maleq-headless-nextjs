/**
 * Wishlist Store
 *
 * Global state management for wishlist using Zustand
 * Uses persist middleware for automatic localStorage persistence
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

/**
 * Wishlist Store
 *
 * Uses Zustand persist middleware for automatic localStorage persistence
 */
export const useWishlistStore = create<WishlistStore>()(
  persist(
    (set, get) => ({
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

        set({ items: [...state.items, newItem] });
      },

      /**
       * Remove item from wishlist
       */
      removeItem: (productId) => {
        const state = get();
        set({ items: state.items.filter((item) => item.productId !== productId) });
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
          set({ items: state.items.filter((item) => item.productId !== productId) });
          return false;
        } else {
          // Add item
          const newItem: WishlistItem = {
            ...itemData,
            id: `wishlist-${productId}`,
            addedAt: Date.now(),
          };
          set({ items: [...state.items, newItem] });
          return true;
        }
      },

      /**
       * Clear all items from wishlist
       */
      clearWishlist: () => {
        set({ items: [] });
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
       * Note: With persist middleware, hydration is automatic.
       * This method is kept for backwards compatibility with WishlistProvider.
       */
      hydrate: () => {
        // Persist middleware handles hydration automatically
        // This is a no-op for backwards compatibility
      },
    }),
    {
      name: 'maleq-wishlist', // Storage key (kebab-case standardized)
      partialize: (state) => ({
        // Only persist wishlist items, not UI state
        items: state.items,
      }),
    }
  )
);

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
