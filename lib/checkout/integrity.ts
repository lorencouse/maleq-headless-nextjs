import { createHash } from 'crypto';

interface CheckoutFingerprintItem {
  productId: string | number;
  variationId?: string | number | null;
  quantity: number;
}

interface CheckoutFingerprintInput {
  cartItems: CheckoutFingerprintItem[];
  shippingMethodId: string;
  shippingCountry?: string | null;
  customerId?: number | null;
  customerEmail?: string | null;
}

function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

function normalizeCountry(country?: string | null): string {
  return (country || '').trim().toUpperCase();
}

function normalizeItems(items: CheckoutFingerprintItem[]): Array<{
  productId: string;
  variationId: string;
  quantity: number;
}> {
  return items
    .map((item) => ({
      productId: String(item.productId).trim(),
      variationId: item.variationId ? String(item.variationId).trim() : '',
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
    }))
    .sort((a, b) => {
      const left = `${a.productId}:${a.variationId}`;
      const right = `${b.productId}:${b.variationId}`;
      return left.localeCompare(right);
    });
}

export function buildCheckoutFingerprint(input: CheckoutFingerprintInput): string {
  const payload = {
    v: 1,
    shippingMethodId: input.shippingMethodId.trim(),
    shippingCountry: normalizeCountry(input.shippingCountry),
    customerId: input.customerId || 0,
    customerEmail: normalizeEmail(input.customerEmail),
    cartItems: normalizeItems(input.cartItems),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildCheckoutCustomerRef(
  customerId?: number | null,
  customerEmail?: string | null
): string {
  if (customerId && customerId > 0) {
    return `customer:${customerId}`;
  }

  const normalizedEmail = normalizeEmail(customerEmail);
  if (!normalizedEmail) {
    return 'guest:anonymous';
  }

  const emailHash = createHash('sha256').update(normalizedEmail).digest('hex');
  return `guest:${emailHash.slice(0, 32)}`;
}
