/**
 * Barrel export for Zustand stores
 */

// Auth Store
export {
  useAuthStore,
  useUser,
  useIsAuthenticated,
  useAuthToken,
  useAuthLoading,
  useAuthError,
} from './auth-store';
export type { User } from './auth-store';

// Cart Store
export {
  useCartStore,
  useCartItemCount,
  useCartSubtotal,
  useCartTotal,
  useIsCartEmpty,
  useIsInCart,
} from './cart-store';

// Wishlist Store
export {
  useWishlistStore,
  useWishlistItemCount,
  useIsInWishlist,
} from './wishlist-store';
export type { WishlistItem } from './wishlist-store';

// Checkout Store
export {
  useCheckoutStore,
  useCheckoutContact,
  useCheckoutShipping,
  useCheckoutBilling,
  useCheckoutMethod,
  useCheckoutTotals,
  useCheckoutTax,
  useCheckoutStep,
  useIsCheckoutProcessing,
} from './checkout-store';
export type {
  ContactInfo,
  ShippingAddress,
  BillingAddress,
  ShippingMethodInfo,
  CheckoutTotals,
} from './checkout-store';
