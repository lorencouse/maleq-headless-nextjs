// Google Analytics 4 tracking utilities

export const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_ID || '';

// Check if GA is available
export const isGAAvailable = (): boolean => {
  return typeof window !== 'undefined' && GA_TRACKING_ID !== '';
};

// Initialize gtag
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

// Page view tracking
export const pageview = (url: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('config', GA_TRACKING_ID, {
    page_path: url,
  });
};

// Custom event tracking
export const event = ({
  action,
  category,
  label,
  value,
}: {
  action: string;
  category: string;
  label?: string;
  value?: number;
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};

// E-commerce: View Item
export const viewItem = (item: {
  item_id: string;
  item_name: string;
  price: number;
  currency?: string;
  item_category?: string;
  item_brand?: string;
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'view_item', {
    currency: item.currency || 'USD',
    value: item.price,
    items: [
      {
        item_id: item.item_id,
        item_name: item.item_name,
        price: item.price,
        currency: item.currency || 'USD',
        item_category: item.item_category,
        item_brand: item.item_brand,
      },
    ],
  });
};

// E-commerce: Add to Cart
export const addToCart = (item: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  currency?: string;
  item_category?: string;
  item_variant?: string;
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'add_to_cart', {
    currency: item.currency || 'USD',
    value: item.price * item.quantity,
    items: [
      {
        item_id: item.item_id,
        item_name: item.item_name,
        price: item.price,
        quantity: item.quantity,
        currency: item.currency || 'USD',
        item_category: item.item_category,
        item_variant: item.item_variant,
      },
    ],
  });
};

// E-commerce: Remove from Cart
export const removeFromCart = (item: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  currency?: string;
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'remove_from_cart', {
    currency: item.currency || 'USD',
    value: item.price * item.quantity,
    items: [
      {
        item_id: item.item_id,
        item_name: item.item_name,
        price: item.price,
        quantity: item.quantity,
        currency: item.currency || 'USD',
      },
    ],
  });
};

// E-commerce: View Cart
export const viewCart = (items: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
}[], totalValue: number): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'view_cart', {
    currency: 'USD',
    value: totalValue,
    items: items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
      currency: 'USD',
    })),
  });
};

// E-commerce: Begin Checkout
export const beginCheckout = (items: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
}[], totalValue: number, coupon?: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'begin_checkout', {
    currency: 'USD',
    value: totalValue,
    coupon: coupon,
    items: items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
      currency: 'USD',
    })),
  });
};

// E-commerce: Add Shipping Info
export const addShippingInfo = (items: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
}[], totalValue: number, shippingTier: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'add_shipping_info', {
    currency: 'USD',
    value: totalValue,
    shipping_tier: shippingTier,
    items: items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
      currency: 'USD',
    })),
  });
};

// E-commerce: Add Payment Info
export const addPaymentInfo = (items: {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
}[], totalValue: number, paymentType: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'add_payment_info', {
    currency: 'USD',
    value: totalValue,
    payment_type: paymentType,
    items: items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
      currency: 'USD',
    })),
  });
};

// E-commerce: Purchase
export const purchase = (transaction: {
  transaction_id: string;
  value: number;
  tax: number;
  shipping: number;
  coupon?: string;
  items: {
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
    item_category?: string;
    item_variant?: string;
  }[];
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'purchase', {
    transaction_id: transaction.transaction_id,
    currency: 'USD',
    value: transaction.value,
    tax: transaction.tax,
    shipping: transaction.shipping,
    coupon: transaction.coupon,
    items: transaction.items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
      currency: 'USD',
      item_category: item.item_category,
      item_variant: item.item_variant,
    })),
  });
};

// Search
export const search = (searchTerm: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'search', {
    search_term: searchTerm,
  });
};

// Sign up
export const signUp = (method: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'sign_up', {
    method: method,
  });
};

// Login
export const login = (method: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'login', {
    method: method,
  });
};

// Add to Wishlist
export const addToWishlist = (item: {
  item_id: string;
  item_name: string;
  price: number;
  currency?: string;
}): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'add_to_wishlist', {
    currency: item.currency || 'USD',
    value: item.price,
    items: [
      {
        item_id: item.item_id,
        item_name: item.item_name,
        price: item.price,
        currency: item.currency || 'USD',
      },
    ],
  });
};

// Share
export const share = (method: string, contentType: string, itemId: string): void => {
  if (!isGAAvailable()) return;

  window.gtag('event', 'share', {
    method: method,
    content_type: contentType,
    item_id: itemId,
  });
};
