'use client';

import type { Cart } from '@/lib/types/cart';

const CART_RECOVERY_KEY_STORAGE = 'maleq_cart_recovery_key';

export interface CartRecoverySnapshotPayload {
  email: string;
  customerId?: number | null;
  cart: Cart;
  shippingMethodId?: string | null;
  shippingMethodName?: string | null;
  shippingCountry?: string | null;
  checkoutUrl?: string | null;
  paymentIntentId?: string | null;
}

function generateClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateCartRecoveryKey(): string {
  if (typeof window === 'undefined') {
    return generateClientKey();
  }

  const existing = window.localStorage.getItem(CART_RECOVERY_KEY_STORAGE);
  if (existing) {
    return existing;
  }

  const next = generateClientKey();
  window.localStorage.setItem(CART_RECOVERY_KEY_STORAGE, next);
  return next;
}

export function setCartRecoveryKey(cartKey: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CART_RECOVERY_KEY_STORAGE, cartKey);
}

export function clearCartRecoveryKey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CART_RECOVERY_KEY_STORAGE);
}

export async function persistCartRecoverySnapshot(
  payload: CartRecoverySnapshotPayload
): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await fetch('/api/cart-recovery/upsert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cartKey: getOrCreateCartRecoveryKey(),
        ...payload,
      }),
      keepalive: true,
    });
  } catch {
    // Cart recovery snapshotting should never block checkout.
  }
}
