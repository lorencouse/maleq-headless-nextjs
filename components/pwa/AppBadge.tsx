'use client';

import { useEffect } from 'react';
import { useCartItemCount } from '@/lib/store/cart-store';

/**
 * Syncs cart item count to the PWA app badge (home screen icon).
 * Uses the Badging API — no-ops on browsers that don't support it.
 */
export default function AppBadge() {
  const itemCount = useCartItemCount();

  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;

    if (itemCount > 0) {
      navigator.setAppBadge(itemCount).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  }, [itemCount]);

  return null;
}
