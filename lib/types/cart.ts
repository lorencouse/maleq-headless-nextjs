/**
 * Shopping Cart Type Definitions
 *
 * Defines the structure for cart items, cart state, and cart actions
 */

/**
 * Cart image type (simplified version for cart storage)
 */
export interface CartImage {
  url: string;
  altText: string;
}

/**
 * Represents a single item in the shopping cart
 */
export interface CartItem {
  /** Unique identifier for this cart item (combination of productId + variationId) */
  id: string;

  /** WooCommerce product ID */
  productId: string;

  /** WooCommerce variation ID (for variable products) */
  variationId?: string;

  /** Product name */
  name: string;

  /** Product slug for linking */
  slug: string;

  /** Product SKU */
  sku: string;

  /** Unit price (current price - sale price if on sale, otherwise regular price) */
  price: number;

  /** Regular price (before any discounts) */
  regularPrice: number;

  /** Quantity of this item in cart */
  quantity: number;

  /** Line subtotal (price × quantity) */
  subtotal: number;

  /** Product main image */
  image?: CartImage;

  /** Variation attributes (e.g., { "Color": "Red", "Size": "Medium" }) */
  attributes?: Record<string, string>;

  /** Available stock quantity */
  stockQuantity?: number;

  /** Maximum quantity that can be added (based on stock) */
  maxQuantity: number;

  /** Whether product is in stock */
  inStock: boolean;

  /** Product type (SIMPLE, VARIABLE, etc.) */
  type?: string;
}

/**
 * Shopping cart state
 */
export interface Cart {
  /** Cart items */
  items: CartItem[];

  /** Subtotal (sum of all item subtotals) */
  subtotal: number;

  /** Tax amount */
  tax: number;

  /** Shipping cost */
  shipping: number;

  /** Discount amount (from coupons) */
  discount: number;

  /** Auto-discount amount (threshold-based) */
  autoDiscount: number;

  /** Auto-discount label for display */
  autoDiscountLabel?: string;

  /** Total (subtotal + tax + shipping - discount - autoDiscount) */
  total: number;

  /** Total item count (sum of all quantities) */
  itemCount: number;

  /** Currency code */
  currency: string;

  /** Applied coupon code */
  couponCode?: string;

  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Cart store actions
 */
export interface CartActions {
  /** Add an item to the cart */
  addItem: (item: Omit<CartItem, 'id' | 'subtotal'>) => void;

  /** Remove an item from the cart */
  removeItem: (itemId: string) => void;

  /** Update item quantity */
  updateQuantity: (itemId: string, quantity: number) => void;

  /** Clear all items from cart */
  clearCart: () => void;

  /** Apply a coupon code */
  applyCoupon: (code: string, discountAmount: number) => void;

  /** Remove coupon */
  removeCoupon: () => void;

  /** Update shipping cost */
  updateShipping: (amount: number) => void;

  /** Update tax */
  updateTax: (amount: number) => void;

  /** Get cart item by ID */
  getItem: (itemId: string) => CartItem | undefined;

  /** Check if product is in cart */
  isInCart: (productId: string, variationId?: string) => boolean;

  /** Get total item count */
  getItemCount: () => number;

  /** Recalculate cart totals */
  recalculateTotals: () => void;

  /** Hydrate cart from localStorage (for client-side persistence) */
  hydrate: () => void;

  /** Validate cart before checkout - checks stock, prices, availability */
  validateCart: () => CartValidationResult;
}

/**
 * Combined cart store type
 */
export interface CartStore extends Cart, CartActions {
  /** Loading state */
  isLoading: boolean;

  /** Error message */
  error?: string;
}

/**
 * Helper type for adding products to cart
 */
export interface AddToCartParams {
  productId: string;
  variationId?: string;
  name: string;
  slug: string;
  sku: string;
  price: number;
  regularPrice: number;
  quantity?: number;
  image?: CartImage;
  attributes?: Record<string, string>;
  stockQuantity?: number;
  maxQuantity: number;
  inStock: boolean;
  type?: string;
}

/**
 * Cart validation result
 */
export interface CartValidationResult {
  isValid: boolean;
  errors: CartValidationError[];
}

/**
 * Cart validation error
 */
export interface CartValidationError {
  itemId: string;
  type: 'out_of_stock' | 'insufficient_stock' | 'price_changed' | 'product_unavailable';
  message: string;
  currentValue?: string | number | null;
  expectedValue?: string | number | null;
}
