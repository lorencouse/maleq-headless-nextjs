'use client';

export interface PendingOrderPayload {
  customerId?: number;
  contact: {
    email: string;
    phone?: string;
  };
  shippingAddress: {
    firstName: string;
    lastName: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  shippingMethod: {
    id: string;
    name: string;
    price?: number;
  };
  cartItems: Array<{
    productId: string;
    variationId?: string;
    quantity: number;
    name: string;
    sku: string;
    price?: number;
  }>;
  totals: {
    subtotal: number;
    shipping: number;
    tax: number;
    discount: number;
    total: number;
  };
  couponCode?: string;
  customerNote?: string;
  authToken?: string;
  flow?: 'standard' | 'express';
}

interface PendingOrderRecord {
  paymentIntentId: string;
  createdAt: number;
  payload: PendingOrderPayload;
}

const STORAGE_PREFIX = 'maleq_pending_checkout:';
const LATEST_KEY = 'maleq_pending_checkout_latest';
const TTL_MS = 24 * 60 * 60 * 1000;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function getRecordKey(paymentIntentId: string): string {
  return `${STORAGE_PREFIX}${paymentIntentId}`;
}

function cleanupExpired(storage: Storage): void {
  const now = Date.now();
  const staleKeys: string[] = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;

    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PendingOrderRecord;
      if (!parsed.createdAt || now - parsed.createdAt > TTL_MS) {
        staleKeys.push(key);
      }
    } catch {
      staleKeys.push(key);
    }
  }

  staleKeys.forEach((key) => storage.removeItem(key));
}

export function savePendingCheckout(paymentIntentId: string, payload: PendingOrderPayload): void {
  const storage = getStorage();
  if (!storage || !paymentIntentId) return;

  cleanupExpired(storage);

  const record: PendingOrderRecord = {
    paymentIntentId,
    createdAt: Date.now(),
    payload,
  };

  storage.setItem(getRecordKey(paymentIntentId), JSON.stringify(record));
  storage.setItem(LATEST_KEY, paymentIntentId);
}

export function getPendingCheckout(paymentIntentId?: string): PendingOrderRecord | null {
  const storage = getStorage();
  if (!storage) return null;

  cleanupExpired(storage);

  const resolvedPaymentIntentId = paymentIntentId || storage.getItem(LATEST_KEY);
  if (!resolvedPaymentIntentId) return null;

  const raw = storage.getItem(getRecordKey(resolvedPaymentIntentId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingOrderRecord;
    if (!parsed?.paymentIntentId || !parsed?.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(paymentIntentId?: string): void {
  const storage = getStorage();
  if (!storage) return;

  const resolvedPaymentIntentId = paymentIntentId || storage.getItem(LATEST_KEY);
  if (!resolvedPaymentIntentId) return;

  storage.removeItem(getRecordKey(resolvedPaymentIntentId));
  const latest = storage.getItem(LATEST_KEY);
  if (latest === resolvedPaymentIntentId) {
    storage.removeItem(LATEST_KEY);
  }
}
