/**
 * Cart Provider Component
 *
 * Initializes the cart store by hydrating from localStorage
 * Must be a client component and included in the root layout
 */

'use client';

import { useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';

export function CartProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Hydrate cart from localStorage on mount
    useCartStore.getState().hydrate();
  }, []);

  return <>{children}</>;
}
