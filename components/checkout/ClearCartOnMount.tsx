'use client';

import { useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { useCheckoutStore } from '@/lib/store/checkout-store';

/**
 * Client component that clears cart and checkout state on mount.
 * Used on the order confirmation page to clean up after a successful purchase.
 */
export default function ClearCartOnMount() {
  const clearCart = useCartStore((state) => state.clearCart);
  const clearCheckout = useCheckoutStore((state) => state.clearCheckout);

  useEffect(() => {
    clearCart();
    clearCheckout();
  }, [clearCart, clearCheckout]);

  return null;
}
