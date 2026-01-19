/**
 * Cart Helper Utilities
 *
 * Functions for cart calculations, validations, and transformations
 */

import { Cart, CartItem } from '../types/cart';

/**
 * Generate a unique cart item ID from product and variation IDs
 */
export function generateCartItemId(productId: string, variationId?: string): string {
  return variationId ? `${productId}-${variationId}` : productId;
}

/**
 * Calculate line subtotal for a cart item
 */
export function calculateLineSubtotal(price: number, quantity: number): number {
  return Number((price * quantity).toFixed(2));
}

/**
 * Calculate cart subtotal (sum of all line subtotals)
 */
export function calculateCartSubtotal(items: CartItem[]): number {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return Number(subtotal.toFixed(2));
}

/**
 * Calculate total item count in cart
 */
export function calculateItemCount(items: CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}

/**
 * Calculate cart total
 */
export function calculateCartTotal(
  subtotal: number,
  tax: number = 0,
  shipping: number = 0,
  discount: number = 0
): number {
  const total = subtotal + tax + shipping - discount;
  return Number(Math.max(0, total).toFixed(2));
}

/**
 * Validate quantity against stock
 */
export function validateQuantity(
  quantity: number,
  maxQuantity: number,
  inStock: boolean
): { isValid: boolean; validQuantity: number; message?: string } {
  // Must be at least 1
  if (quantity < 1) {
    return {
      isValid: false,
      validQuantity: 1,
      message: 'Quantity must be at least 1',
    };
  }

  // Must be in stock
  if (!inStock) {
    return {
      isValid: false,
      validQuantity: 0,
      message: 'Product is out of stock',
    };
  }

  // Cannot exceed max quantity
  if (quantity > maxQuantity) {
    return {
      isValid: false,
      validQuantity: maxQuantity,
      message: `Only ${maxQuantity} available in stock`,
    };
  }

  return { isValid: true, validQuantity: quantity };
}

/**
 * Format price for display
 */
export function formatPrice(price: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
}

/**
 * Calculate savings amount
 */
export function calculateSavings(regularPrice: number, salePrice: number): number {
  return Number(Math.max(0, regularPrice - salePrice).toFixed(2));
}

/**
 * Calculate savings percentage
 */
export function calculateSavingsPercentage(
  regularPrice: number,
  salePrice: number
): number {
  if (regularPrice <= 0) return 0;
  const savings = ((regularPrice - salePrice) / regularPrice) * 100;
  return Number(Math.max(0, savings).toFixed(0));
}

/**
 * Merge cart items (when adding an item that already exists)
 */
export function mergeCartItem(
  existingItem: CartItem,
  newQuantity: number
): CartItem {
  const updatedQuantity = Math.min(
    existingItem.quantity + newQuantity,
    existingItem.maxQuantity
  );

  return {
    ...existingItem,
    quantity: updatedQuantity,
    subtotal: calculateLineSubtotal(existingItem.price, updatedQuantity),
  };
}

/**
 * Persist cart to localStorage
 */
export function persistCart(cart: Cart): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('maleq_cart', JSON.stringify(cart));
  } catch (error) {
    console.error('Failed to persist cart to localStorage:', error);
  }
}

/**
 * Load cart from localStorage
 */
export function loadCart(): Cart | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem('maleq_cart');
    if (!stored) return null;

    const cart = JSON.parse(stored) as Cart;

    // Validate that cart has required structure
    if (!cart.items || !Array.isArray(cart.items)) {
      return null;
    }

    return cart;
  } catch (error) {
    console.error('Failed to load cart from localStorage:', error);
    return null;
  }
}

/**
 * Clear cart from localStorage
 */
export function clearPersistedCart(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem('maleq_cart');
  } catch (error) {
    console.error('Failed to clear cart from localStorage:', error);
  }
}

/**
 * Check if two cart items are the same product
 */
export function isSameProduct(
  item1: { productId: string; variationId?: string },
  item2: { productId: string; variationId?: string }
): boolean {
  return (
    item1.productId === item2.productId &&
    item1.variationId === item2.variationId
  );
}

/**
 * Get cart item summary for display
 */
export function getCartSummary(cart: Cart): {
  itemCount: number;
  subtotal: string;
  total: string;
  hasCoupon: boolean;
  hasShipping: boolean;
} {
  return {
    itemCount: cart.itemCount,
    subtotal: formatPrice(cart.subtotal, cart.currency),
    total: formatPrice(cart.total, cart.currency),
    hasCoupon: !!cart.couponCode,
    hasShipping: cart.shipping > 0,
  };
}

/**
 * Create empty cart state
 */
export function createEmptyCart(): Cart {
  return {
    items: [],
    subtotal: 0,
    tax: 0,
    shipping: 0,
    discount: 0,
    total: 0,
    itemCount: 0,
    currency: 'USD',
    updatedAt: Date.now(),
  };
}

/**
 * Check if cart is empty
 */
export function isCartEmpty(cart: Cart): boolean {
  return cart.items.length === 0;
}

/**
 * Get unique product count (not including quantities)
 */
export function getUniqueProductCount(cart: Cart): number {
  return cart.items.length;
}

/**
 * Estimate tax (simple calculation - can be replaced with real tax API)
 * Default to 8% for now
 */
export function estimateTax(subtotal: number, taxRate: number = 0.08): number {
  return Number((subtotal * taxRate).toFixed(2));
}

/**
 * Calculate free shipping threshold progress
 */
export function getFreeShippingProgress(
  subtotal: number,
  threshold: number = 100
): {
  qualifies: boolean;
  remaining: number;
  percentage: number;
} {
  const qualifies = subtotal >= threshold;
  const remaining = qualifies ? 0 : threshold - subtotal;
  const percentage = Math.min(100, (subtotal / threshold) * 100);

  return {
    qualifies,
    remaining: Number(remaining.toFixed(2)),
    percentage: Number(percentage.toFixed(0)),
  };
}
