/**
 * Wishlist Provider Component
 *
 * Initializes the wishlist store by hydrating from localStorage
 * Must be a client component and included in the root layout
 */

'use client';

import { useEffect } from 'react';
import { useWishlistStore } from '@/lib/store/wishlist-store';

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Hydrate wishlist from localStorage on mount
    useWishlistStore.getState().hydrate();
  }, []);

  return <>{children}</>;
}
