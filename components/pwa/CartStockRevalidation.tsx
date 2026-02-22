'use client';

import { useEffect, useRef } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { showError } from '@/lib/utils/toast';

/**
 * Revalidates cart item stock status when coming back online.
 * If any cart items are now out of stock, notifies the user.
 */
export default function CartStockRevalidation() {
  const items = useCartStore((state) => state.items);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    const revalidate = async () => {
      if (items.length === 0) return;

      // Throttle: don't check more than once per 5 minutes
      const now = Date.now();
      if (now - lastCheckRef.current < 5 * 60 * 1000) return;
      lastCheckRef.current = now;

      const outOfStock: string[] = [];

      // Check each cart item's stock (in parallel, limited to 5 concurrent)
      const checks = items.map(async (item) => {
        try {
          const res = await fetch(`/api/products/${item.productId}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.product?.stockStatus === 'OUT_OF_STOCK') {
            outOfStock.push(item.name);
          }
        } catch {
          // Network error — skip silently
        }
      });

      await Promise.all(checks);

      if (outOfStock.length > 0) {
        const names = outOfStock.length <= 2
          ? outOfStock.join(' and ')
          : `${outOfStock.length} items`;
        showError(`${names} in your cart ${outOfStock.length === 1 ? 'is' : 'are'} now out of stock.`);
      }
    };

    window.addEventListener('online', revalidate);

    // Also check on mount if online
    if (navigator.onLine && items.length > 0) {
      revalidate();
    }

    return () => window.removeEventListener('online', revalidate);
  }, [items]);

  return null;
}
