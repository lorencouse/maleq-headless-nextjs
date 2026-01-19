/**
 * Shopping Cart Store
 *
 * Global state management for shopping cart using Zustand
 * Includes localStorage persistence and automatic total calculations
 */

'use client';

import { create } from 'zustand';
import { CartStore, CartItem, AddToCartParams } from '../types/cart';
import {
  generateCartItemId,
  calculateLineSubtotal,
  calculateCartSubtotal,
  calculateItemCount,
  calculateCartTotal,
  validateQuantity,
  mergeCartItem,
  persistCart,
  loadCart,
  clearPersistedCart,
  createEmptyCart,
  isSameProduct,
} from '../utils/cart-helpers';

/**
 * Cart Store
 *
 * Manages shopping cart state with persistence
 */
export const useCartStore = create<CartStore>((set, get) => ({
  // Initial state
  ...createEmptyCart(),
  isLoading: false,
  error: undefined,

  /**
   * Add item to cart
   * If item already exists, increment quantity
   */
  addItem: (params: AddToCartParams) => {
    const state = get();
    const itemId = generateCartItemId(params.productId, params.variationId);
    const quantity = params.quantity || 1;

    // Validate quantity
    const validation = validateQuantity(
      quantity,
      params.maxQuantity,
      params.inStock
    );

    if (!validation.isValid) {
      set({ error: validation.message });
      return;
    }

    // Check if item already in cart
    const existingItem = state.items.find((item) => item.id === itemId);

    let updatedItems: CartItem[];

    if (existingItem) {
      // Merge with existing item
      const newQuantity = existingItem.quantity + quantity;
      const quantityValidation = validateQuantity(
        newQuantity,
        params.maxQuantity,
        params.inStock
      );

      if (!quantityValidation.isValid) {
        set({ error: quantityValidation.message });
        return;
      }

      updatedItems = state.items.map((item) =>
        item.id === itemId
          ? mergeCartItem(item, quantity)
          : item
      );
    } else {
      // Add new item
      const newItem: CartItem = {
        id: itemId,
        productId: params.productId,
        variationId: params.variationId,
        name: params.name,
        slug: params.slug,
        sku: params.sku,
        price: params.price,
        regularPrice: params.regularPrice,
        quantity: validation.validQuantity,
        subtotal: calculateLineSubtotal(params.price, validation.validQuantity),
        image: params.image,
        attributes: params.attributes,
        stockQuantity: params.stockQuantity,
        maxQuantity: params.maxQuantity,
        inStock: params.inStock,
        type: params.type,
      };

      updatedItems = [...state.items, newItem];
    }

    // Update state and recalculate
    set({ items: updatedItems, error: undefined });
    get().recalculateTotals();
  },

  /**
   * Remove item from cart
   */
  removeItem: (itemId: string) => {
    const state = get();
    const updatedItems = state.items.filter((item) => item.id !== itemId);

    set({ items: updatedItems, error: undefined });
    get().recalculateTotals();
  },

  /**
   * Update item quantity
   */
  updateQuantity: (itemId: string, quantity: number) => {
    const state = get();
    const item = state.items.find((i) => i.id === itemId);

    if (!item) {
      set({ error: 'Item not found in cart' });
      return;
    }

    // Validate new quantity
    const validation = validateQuantity(
      quantity,
      item.maxQuantity,
      item.inStock
    );

    if (!validation.isValid) {
      set({ error: validation.message });
      return;
    }

    // Update quantity
    const updatedItems = state.items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            quantity: validation.validQuantity,
            subtotal: calculateLineSubtotal(i.price, validation.validQuantity),
          }
        : i
    );

    set({ items: updatedItems, error: undefined });
    get().recalculateTotals();
  },

  /**
   * Clear all items from cart
   */
  clearCart: () => {
    set({
      ...createEmptyCart(),
      error: undefined,
    });
    clearPersistedCart();
  },

  /**
   * Apply coupon code
   */
  applyCoupon: (code: string, discountAmount: number) => {
    set({
      couponCode: code,
      discount: discountAmount,
    });
    get().recalculateTotals();
  },

  /**
   * Remove coupon
   */
  removeCoupon: () => {
    set({
      couponCode: undefined,
      discount: 0,
    });
    get().recalculateTotals();
  },

  /**
   * Update shipping cost
   */
  updateShipping: (amount: number) => {
    set({ shipping: amount });
    get().recalculateTotals();
  },

  /**
   * Update tax
   */
  updateTax: (amount: number) => {
    set({ tax: amount });
    get().recalculateTotals();
  },

  /**
   * Get cart item by ID
   */
  getItem: (itemId: string) => {
    return get().items.find((item) => item.id === itemId);
  },

  /**
   * Check if product is in cart
   */
  isInCart: (productId: string, variationId?: string) => {
    const state = get();
    return state.items.some((item) =>
      isSameProduct(item, { productId, variationId })
    );
  },

  /**
   * Get total item count
   */
  getItemCount: () => {
    return get().itemCount;
  },

  /**
   * Recalculate all cart totals
   */
  recalculateTotals: () => {
    const state = get();
    const subtotal = calculateCartSubtotal(state.items);
    const itemCount = calculateItemCount(state.items);
    const total = calculateCartTotal(
      subtotal,
      state.tax,
      state.shipping,
      state.discount
    );

    const updatedCart = {
      ...state,
      subtotal,
      itemCount,
      total,
      updatedAt: Date.now(),
    };

    set(updatedCart);

    // Persist to localStorage
    persistCart({
      items: updatedCart.items,
      subtotal: updatedCart.subtotal,
      tax: updatedCart.tax,
      shipping: updatedCart.shipping,
      discount: updatedCart.discount,
      total: updatedCart.total,
      itemCount: updatedCart.itemCount,
      currency: updatedCart.currency,
      couponCode: updatedCart.couponCode,
      updatedAt: updatedCart.updatedAt,
    });
  },

  /**
   * Hydrate cart from localStorage
   * Call this on app initialization
   */
  hydrate: () => {
    if (typeof window === 'undefined') return;

    set({ isLoading: true });

    const savedCart = loadCart();

    if (savedCart) {
      set({
        ...savedCart,
        isLoading: false,
        error: undefined,
      });
    } else {
      set({ isLoading: false });
    }
  },
}));

/**
 * Hook to get cart item count (for header badge)
 */
export function useCartItemCount(): number {
  return useCartStore((state) => state.itemCount);
}

/**
 * Hook to get cart subtotal
 */
export function useCartSubtotal(): number {
  return useCartStore((state) => state.subtotal);
}

/**
 * Hook to get cart total
 */
export function useCartTotal(): number {
  return useCartStore((state) => state.total);
}

/**
 * Hook to check if cart is empty
 */
export function useIsCartEmpty(): boolean {
  return useCartStore((state) => state.items.length === 0);
}

/**
 * Hook to check if product is in cart
 */
export function useIsInCart(productId: string, variationId?: string): boolean {
  return useCartStore((state) => state.isInCart(productId, variationId));
}
