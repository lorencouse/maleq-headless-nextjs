# E-Commerce Store Specifications

**Project**: Maleq Headless E-Commerce Store
**Version**: 1.0
**Last Updated**: 2026-01-19
**Tech Stack**: Next.js 15, TypeScript, WooCommerce (Headless), WordPress GraphQL, Williams Trading API

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Current State Analysis](#current-state-analysis)
3. [Feature Specifications](#feature-specifications)
4. [Data Architecture](#data-architecture)
5. [User Experience & Design](#user-experience--design)
6. [Technical Requirements](#technical-requirements)
7. [Performance & SEO](#performance--seo)
8. [Security & Compliance](#security--compliance)
9. [Future Enhancements](#future-enhancements)

---

## Project Overview

### Business Goals
- Create a robust, high-performance e-commerce platform for adult products
- Seamless integration with Williams Trading wholesale inventory
- Provide exceptional user experience with fast page loads and intuitive navigation
- Support complex product variations and detailed specifications
- Enable content marketing through integrated blog

### Target Users
- **Primary**: Retail customers browsing and purchasing products
- **Secondary**: Content consumers (blog readers)
- **Admin**: Store managers syncing inventory and managing content

---

## Current State Analysis

### ✅ Implemented Features

**Pages & Routing**
- ✅ Home page with hero, featured products, blog posts
- ✅ Shop/product listing page with filters and grid
- ✅ Individual product detail pages (server-rendered)
- ✅ Blog listing with pagination
- ✅ Individual blog posts with comments
- ✅ Admin sync interfaces
- ✅ API endpoints for product sync and revalidation

**Product Features**
- ✅ Product card components with images, pricing, stock badges
- ✅ Product image gallery with thumbnails
- ✅ Variation selector with intelligent filtering
- ✅ Product specifications display
- ✅ Stock status indicators
- ✅ Sale/pricing display
- ✅ Search functionality (basic)
- ✅ Category filtering

**Data Integration**
- ✅ Williams Trading API integration
- ✅ WooCommerce REST API client
- ✅ WordPress GraphQL integration
- ✅ Product data transformation pipeline
- ✅ Category hierarchy mapping
- ✅ Manufacturer synchronization
- ✅ Image processing and upload
- ✅ Stock synchronization

**Infrastructure**
- ✅ Dark/light theme toggle
- ✅ Responsive design (partial)
- ✅ Server-side rendering (SSR)
- ✅ Incremental Static Regeneration (ISR)
- ✅ Image optimization with Sharp
- ✅ Apollo Client setup for GraphQL

### ❌ Missing Critical Features

**Shopping Experience**
- ❌ Shopping cart (not implemented - only hardcoded icon)
- ❌ Mini cart dropdown/slide-out
- ❌ Add to cart functionality
- ❌ Cart page with line items
- ❌ Cart quantity updates
- ❌ Remove from cart
- ❌ Cart persistence (localStorage/session/cookies)
- ❌ Checkout process (multi-step or single page)
- ❌ Payment gateway integration
- ❌ Shipping calculations
- ❌ Tax calculations
- ❌ Order confirmation page
- ❌ Order history/account area

**Product Discovery**
- ❌ Advanced filters (price range, attributes, ratings)
- ❌ Filter chips/active filters display
- ❌ Sort options (price, popularity, newest, rating)
- ❌ Faceted search
- ❌ Product quick view modal
- ❌ Related products recommendations
- ❌ Recently viewed products
- ❌ Wishlist/favorites

**User Account**
- ❌ User registration
- ❌ User login/logout
- ❌ Account dashboard
- ❌ Order history
- ❌ Address management
- ❌ Password reset
- ❌ Email verification

**Content & Information**
- ❌ About page (referenced but not created)
- ❌ Contact page (referenced but not created)
- ❌ FAQ page
- ❌ Shipping & returns policy
- ❌ Privacy policy
- ❌ Terms & conditions
- ❌ Size/specification guides

**Product Engagement**
- ❌ Product reviews and ratings
- ❌ Review submission
- ❌ Review moderation
- ❌ Product comparison
- ❌ Social sharing buttons
- ❌ Email product to friend

**Mobile Experience**
- ❌ Mobile navigation menu
- ❌ Mobile-optimized filters
- ❌ Touch-optimized image gallery
- ❌ Mobile checkout flow

**Search & Navigation**
- ❌ Search autocomplete/suggestions
- ❌ Search results page with filters
- ❌ Breadcrumb navigation
- ❌ Category pages (distinct from shop page)
- ❌ Mega menu for categories
- ❌ Site search with facets

**Notifications & Feedback**
- ❌ Toast notifications (add to cart, errors, success)
- ❌ Loading states
- ❌ Error boundaries
- ❌ Form validation messages
- ❌ Stock alerts/back-in-stock notifications

---

## Feature Specifications

### 1. Product Catalog

#### 1.1 Product Listing Page (`/shop` and `/shop/category/[slug]`)

**Requirements**
- Display products in responsive grid (2-col mobile, 3-col tablet, 4-col desktop)
- Support for simple and variable products
- Pagination with URL state (`?page=2`)
- Product count display ("Showing 1-24 of 487 products")
- Loading skeleton states
- Empty state messaging

**Product Card Components**
```typescript
interface ProductCardProps {
  product: UnifiedProduct;
  priority?: boolean; // For above-fold images
  showQuickView?: boolean;
  onQuickView?: (product: UnifiedProduct) => void;
  onAddToWishlist?: (productId: string) => void;
}
```

**Card Content**
- Product image with hover effect (show second image or zoom)
- Product name (linked to detail page)
- Price (regular, sale, from price for variations)
- Sale badge percentage
- Stock status badge (In Stock, Low Stock <5, Out of Stock)
- Quick add to cart button (simple products only)
- Quick view icon
- Wishlist heart icon
- Rating stars with count
- Variation count indicator ("6 options available")

#### 1.2 Filtering & Sorting

**Filter Types**

1. **Category Filter** (Already partially implemented)
   - Multi-level category tree
   - Show product count per category
   - Expandable/collapsible subcategories
   - Clear active filters
   - Mobile: Slide-out filter panel

2. **Price Range Filter**
   - Dual-range slider
   - Min/max input fields
   - Common presets ($0-$25, $25-$50, $50-$100, $100+)
   - Dynamic price range based on filtered results

3. **Attribute Filters** (Size, Color, Material, Brand, etc.)
   - Checkboxes for multi-select
   - Show available count per option
   - Disabled state for unavailable combinations
   - Search within filter (for large option lists)

4. **Availability Filter**
   - In Stock
   - On Sale
   - New Arrivals (added in last 30 days)

5. **Rating Filter**
   - 4+ stars
   - 3+ stars
   - 2+ stars
   - 1+ stars

6. **Manufacturer/Brand Filter**
   - Checkbox list
   - Search functionality
   - Show product count

**Active Filters Display**
```
Active Filters: [Category: Dildos ×] [Price: $25-$50 ×] [In Stock ×] [Clear All]
```

**Sort Options**
- Popularity (default)
- Average Rating
- Latest (newest first)
- Price: Low to High
- Price: High to Low
- Name: A to Z
- Name: Z to A

**URL State Management**
```
/shop?category=dildos&price_min=25&price_max=50&in_stock=true&sort=price_asc&page=2
```

**Filter UI Components**
```typescript
interface FilterPanelProps {
  categories: ProductCategory[];
  priceRange: { min: number; max: number };
  attributes: ProductAttribute[];
  manufacturers: Manufacturer[];
  activeFilters: ActiveFilters;
  onFilterChange: (filters: Partial<ActiveFilters>) => void;
  onClearAll: () => void;
}

interface ActiveFilters {
  categories: string[];
  priceMin?: number;
  priceMax?: number;
  attributes: Record<string, string[]>; // { "size": ["small", "medium"] }
  inStock?: boolean;
  onSale?: boolean;
  minRating?: number;
  manufacturers: string[];
}
```

#### 1.3 Product Detail Page (`/shop/product/[slug]`)

**Page Sections**

1. **Product Gallery** (Already implemented, needs enhancement)
   - Main image display (zoomable)
   - Thumbnail grid (4-6 thumbnails)
   - Full-screen lightbox mode
   - Video support (if applicable)
   - 360° view support (future)
   - Mobile: Swipe gallery

2. **Product Information**
   - Product title (H1)
   - SKU display
   - Stock status with quantity (if low stock)
   - Price display (regular, sale, savings %)
   - Short description/highlights (bullet points)
   - Rating summary with review count
   - Social share buttons (Facebook, Twitter, Pinterest, Email)

3. **Product Configuration**
   - Variation selector (already implemented - enhance UX)
   - Quantity selector (min: 1, max: stock quantity)
   - Add to Cart button (large, prominent)
   - Add to Wishlist button
   - Buy Now button (skip cart, go to checkout)
   - Stock availability per variation
   - Price update based on variation

4. **Product Details Tabs**
   ```typescript
   enum ProductTab {
     DESCRIPTION = "description",
     SPECIFICATIONS = "specifications", // Already implemented
     REVIEWS = "reviews",
     SHIPPING = "shipping",
     FAQ = "faq"
   }
   ```

   - **Description Tab**: Full HTML description, features, benefits
   - **Specifications Tab**: Existing specs + additional attributes
   - **Reviews Tab**: Rating summary, review list, write review form
   - **Shipping Tab**: Shipping info, delivery estimates, return policy
   - **FAQ Tab**: Common questions about the product

5. **Related Products**
   - "You May Also Like" (same category)
   - "Customers Also Bought" (based on order history)
   - "Recently Viewed" (client-side storage)
   - Horizontal scroll carousel (4-6 products)

6. **Breadcrumbs**
   ```
   Home > Shop > Category > Subcategory > Product Name
   ```

7. **Structured Data (Schema.org)**
   - Product schema with price, availability, ratings, reviews
   - Breadcrumb schema
   - Organization schema

**Variation Selection Flow** (Enhancement)
```typescript
interface VariationSelectionState {
  selectedAttributes: Record<string, string>; // { "color": "red", "size": "medium" }
  matchedVariation?: ProductVariation;
  isComplete: boolean;
  availableOptions: Record<string, string[]>; // Filtered based on selection
  price?: string;
  stockStatus?: string;
  stockQuantity?: number;
}
```

**Add to Cart Action**
```typescript
interface AddToCartPayload {
  productId: string;
  variationId?: string;
  quantity: number;
  attributes?: Record<string, string>;
}

interface AddToCartResponse {
  success: boolean;
  cartItem?: CartItem;
  cart?: Cart;
  message: string;
}
```

#### 1.4 Quick View Modal

**Trigger**: Click quick view icon on product card

**Modal Content**
- Product image (single, not full gallery)
- Product name
- Price
- Rating summary
- Short description
- Variation selector (if applicable)
- Quantity selector
- Add to Cart button
- "View Full Details" link to product page
- Close button

**Benefits**
- Faster add to cart without page navigation
- Better conversion rate
- Mobile-friendly

---

### 2. Shopping Cart

#### 2.1 Cart State Management

**State Storage Options**
1. **Session Storage** (Recommended for MVP)
   - Persists during session
   - Cleared on browser close
   - No backend required initially

2. **Local Storage**
   - Persists across sessions
   - Can sync with backend when user logs in

3. **Backend/Database** (For logged-in users)
   - Persistent across devices
   - WooCommerce cart session API
   - Sync local cart on login

**Cart Data Structure**
```typescript
interface Cart {
  items: CartItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
  itemCount: number; // Total quantity across all items
  currency: string;
  timestamp: number;
}

interface CartItem {
  id: string; // Unique cart item ID
  productId: string;
  variationId?: string;
  name: string;
  slug: string;
  sku: string;
  price: number; // Unit price
  quantity: number;
  subtotal: number; // price × quantity
  image?: ProductImage;
  attributes?: Record<string, string>; // For variations
  stockQuantity?: number;
  maxQuantity: number; // Stock limit
  inStock: boolean;
}
```

**Cart Actions**
```typescript
interface CartActions {
  addItem: (product: UnifiedProduct, variation?: ProductVariation, quantity?: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: (code: string) => Promise<void>;
  getCart: () => Cart;
  getItemCount: () => number;
}
```

**React Context/State Management**
```typescript
// Using React Context + useReducer
interface CartContextValue {
  cart: Cart;
  isLoading: boolean;
  error?: string;
  actions: CartActions;
}

// Or using Zustand (recommended for better performance)
interface CartStore {
  cart: Cart;
  isLoading: boolean;
  error?: string;
  addItem: (product: UnifiedProduct, variation?: ProductVariation, quantity?: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  // ... other actions
}
```

#### 2.2 Mini Cart Component

**Trigger**: Click cart icon in header

**Display Type**: Slide-out panel from right side (overlay)

**Content**
- Header: "Shopping Cart (3 items)" with close button
- Cart items list (scrollable if > 4 items)
  - Product thumbnail (small, 60×60px)
  - Product name (linked)
  - Variation attributes (if applicable)
  - Price × Quantity = Subtotal
  - Remove button (trash icon)
  - Quantity selector (minimal, +/- buttons)
- Subtotal row
- "View Cart" button (secondary)
- "Checkout" button (primary, prominent)
- Empty state: "Your cart is empty" + "Continue Shopping" link

**Behavior**
- Auto-open on add to cart (with 3-second auto-close)
- Show toast notification: "Product added to cart"
- Backdrop click to close
- Escape key to close
- Update in real-time (no manual refresh)

**Mini Cart Item Component**
```typescript
interface MiniCartItemProps {
  item: CartItem;
  onRemove: (itemId: string) => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
}
```

#### 2.3 Cart Page (`/cart`)

**Page Layout**

1. **Header Section**
   - Page title: "Shopping Cart"
   - Item count: "(3 items)"
   - "Continue Shopping" link

2. **Cart Items Table/List**

   **Desktop**: Table format
   | Product | Price | Quantity | Subtotal | Remove |

   **Mobile**: Stacked card format

   **Each Row/Card Contains**:
   - Product thumbnail (100×100px, linked)
   - Product name (linked)
   - Variation attributes
   - SKU
   - Unit price
   - Quantity selector (input + +/- buttons)
     - Min: 1
     - Max: Stock quantity
     - Update on change (with debounce)
   - Line subtotal (price × quantity)
   - Remove button (trash icon with confirmation)
   - Stock status warning (if low/out of stock)

3. **Cart Summary Sidebar** (Right side on desktop, bottom on mobile)
   ```
   Cart Summary
   ───────────────────────
   Subtotal:        $120.00
   Shipping:    Calculated at checkout
   Tax:         Calculated at checkout
   ───────────────────────
   Total:           $120.00

   [Proceed to Checkout] (Primary button)
   [Continue Shopping] (Text link)

   Coupon Code:
   [___________] [Apply]

   Accepted Payment Methods:
   [Visa] [MC] [Amex] [PayPal]
   ```

4. **Empty Cart State**
   - Icon/illustration
   - "Your cart is empty"
   - "Continue Shopping" button
   - "Recently viewed products" section

**Cart Validation**
- Check stock availability on page load
- Show warning for out-of-stock items
- Disable checkout if any item is unavailable
- Auto-update prices if changed
- Show "Cart Updated" notification

**Cart Persistence**
- Save to localStorage on every change
- Restore on page load
- Show loading state while hydrating
- Handle cart migration on login

---

### 3. Checkout Process

#### 3.1 Checkout Flow Options

**Option A: Single-Page Checkout** (Recommended for better conversion)
- All steps visible on one page
- Less friction, fewer abandonment points
- Progressive disclosure (expand sections as completed)

**Option B: Multi-Step Checkout**
- Step 1: Shipping Information
- Step 2: Shipping Method
- Step 3: Payment Information
- Step 4: Review & Confirm
- Progress indicator at top
- Back/Next navigation

#### 3.2 Checkout Page (`/checkout`)

**Pre-requisites**
- Cart must have items
- Redirect to cart if empty

**Page Structure** (Single-Page Approach)

```
┌─────────────────────────────────────────────────────────────────┐
│  Checkout                                        [🔒 Secure]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─── Left Column (60%) ────────────────────────────────────┐  │
│  │                                                           │  │
│  │  1. Contact Information                       [Expand/✓] │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │  Email: [_______________________]                        │  │
│  │  ☐ Email me with news and offers                        │  │
│  │                                                           │  │
│  │  2. Shipping Address                          [Expand/✓] │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │  First Name: [___________]  Last Name: [___________]    │  │
│  │  Company (optional): [________________________]          │  │
│  │  Address: [___________________________________]          │  │
│  │  Apartment, suite, etc.: [____________________]          │  │
│  │  City: [____________]  State: [____]  ZIP: [_____]      │  │
│  │  Country: [United States ▼]                              │  │
│  │  Phone: [_______________]                                 │  │
│  │  ☐ Save this information for next time                  │  │
│  │                                                           │  │
│  │  3. Shipping Method                           [Expand/✓] │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │  ◉ Standard Shipping (5-7 business days)    FREE        │  │
│  │  ○ Express Shipping (2-3 business days)     $15.00      │  │
│  │  ○ Overnight Shipping (1 business day)      $30.00      │  │
│  │                                                           │  │
│  │  4. Payment Method                            [Expand/✓] │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │  ◉ Credit Card  ○ PayPal  ○ Apple Pay                   │  │
│  │                                                           │  │
│  │  Card Number: [____________________________]             │  │
│  │  Name on Card: [___________________________]             │  │
│  │  Expiration: [MM/YY]  CVV: [___]                        │  │
│  │                                                           │  │
│  │  Billing Address:                                        │  │
│  │  ◉ Same as shipping address                              │  │
│  │  ○ Use a different billing address                       │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── Right Column (40%) - Order Summary ───────────────────┐  │
│  │                                                           │  │
│  │  Order Summary                               [Show ▼]    │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │  [img] Product Name                                      │  │
│  │        Color: Red, Size: M           Qty: 1    $40.00   │  │
│  │                                                           │  │
│  │  [img] Another Product                                   │  │
│  │                                  Qty: 2    $80.00       │  │
│  │  ─────────────────────────────────────────────────────── │  │
│  │                                                           │  │
│  │  Discount Code: [___________] [Apply]                    │  │
│  │                                                           │  │
│  │  Subtotal:                                    $120.00    │  │
│  │  Shipping:                                     $15.00    │  │
│  │  Tax:                                          $10.80    │  │
│  │  ═════════════════════════════════════════════════════   │  │
│  │  Total:                           USD         $145.80    │  │
│  │                                                           │  │
│  │  [Complete Order]  (Large primary button)                │  │
│  │                                                           │  │
│  │  🔒 Secure checkout powered by Stripe                    │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Form Validation**
```typescript
interface CheckoutFormData {
  contact: {
    email: string; // Required, email format
    subscribe: boolean;
  };
  shipping: {
    firstName: string; // Required
    lastName: string; // Required
    company?: string;
    address1: string; // Required
    address2?: string;
    city: string; // Required
    state: string; // Required
    postalCode: string; // Required
    country: string; // Required, default: US
    phone: string; // Required, phone format
    saveInfo: boolean;
  };
  shippingMethod: {
    id: string; // Required
    name: string;
    cost: number;
    estimatedDays: string;
  };
  payment: {
    method: 'card' | 'paypal' | 'apple_pay'; // Required
    cardNumber?: string;
    cardName?: string;
    expiryDate?: string;
    cvv?: string;
    billingAddressSame: boolean;
    billingAddress?: Address;
  };
}
```

**Validation Rules**
- Real-time validation on blur
- Display inline error messages
- Scroll to first error on submit
- Required fields marked with *
- Email format validation
- Phone number format validation
- ZIP code format validation (by country)
- Credit card validation (Luhn algorithm)
- CVV length validation (3-4 digits)
- Expiry date validation (not in past)

**Progressive Enhancement**
- Address autocomplete (Google Places API)
- ZIP code lookup for city/state
- Country-based field changes (postal code format)
- Payment method switching (show/hide fields)

#### 3.3 Shipping Calculation

**Integration Options**

1. **Flat Rate Shipping**
   - Simple, predictable
   - Set rates by price or weight
   - Free shipping threshold

2. **Carrier Rates** (USPS, UPS, FedEx)
   - Real-time rate calculation
   - Requires WooCommerce shipping plugins
   - API integration needed

3. **Shipping Zones**
   - Different rates by region
   - Set in WooCommerce backend
   - Fetch via REST API

**Shipping Method Display**
```typescript
interface ShippingMethod {
  id: string;
  name: string;
  description: string;
  cost: number;
  estimatedDays: string; // "5-7 business days"
  carrier?: string;
}

const shippingMethods: ShippingMethod[] = [
  {
    id: 'flat_rate',
    name: 'Standard Shipping',
    description: 'Delivery in 5-7 business days',
    cost: 0, // Free
    estimatedDays: '5-7 business days'
  },
  {
    id: 'expedited',
    name: 'Express Shipping',
    description: 'Delivery in 2-3 business days',
    cost: 15.00,
    estimatedDays: '2-3 business days'
  },
  {
    id: 'overnight',
    name: 'Overnight Shipping',
    description: 'Next business day delivery',
    cost: 30.00,
    estimatedDays: '1 business day'
  }
];
```

#### 3.4 Tax Calculation

**Tax Rules**
- Sales tax based on shipping address
- Different rates by state/region
- Tax-exempt products (if applicable)
- Business tax exemption support

**Integration Options**
1. **WooCommerce Tax Settings**
   - Configure in WooCommerce admin
   - Fetch via GraphQL/REST API

2. **Third-Party Tax Services**
   - TaxJar
   - Avalara
   - Automatic rate updates

**Tax Display**
```typescript
interface TaxCalculation {
  subtotal: number;
  taxRate: number; // Percentage (e.g., 0.08 for 8%)
  taxAmount: number;
  total: number;
}
```

#### 3.5 Payment Integration

**Payment Gateway Options**

1. **Stripe** (Recommended)
   - Wide payment method support
   - Strong fraud protection
   - Excellent developer experience
   - WooCommerce Stripe plugin available

2. **PayPal**
   - Trusted brand
   - Customer accounts
   - Buyer protection

3. **Square**
   - All-in-one solution
   - Good for omnichannel

**Implementation Approach**

**Using WooCommerce Payment Processing**
```typescript
// Create order in WooCommerce
const createOrder = async (checkoutData: CheckoutFormData) => {
  const orderData = {
    payment_method: checkoutData.payment.method,
    payment_method_title: getPaymentMethodTitle(checkoutData.payment.method),
    set_paid: false,
    billing: {
      first_name: checkoutData.shipping.firstName,
      last_name: checkoutData.shipping.lastName,
      address_1: checkoutData.shipping.address1,
      address_2: checkoutData.shipping.address2,
      city: checkoutData.shipping.city,
      state: checkoutData.shipping.state,
      postcode: checkoutData.shipping.postalCode,
      country: checkoutData.shipping.country,
      email: checkoutData.contact.email,
      phone: checkoutData.shipping.phone
    },
    shipping: {
      first_name: checkoutData.shipping.firstName,
      last_name: checkoutData.shipping.lastName,
      address_1: checkoutData.shipping.address1,
      address_2: checkoutData.shipping.address2,
      city: checkoutData.shipping.city,
      state: checkoutData.shipping.state,
      postcode: checkoutData.shipping.postalCode,
      country: checkoutData.shipping.country
    },
    line_items: cart.items.map(item => ({
      product_id: item.productId,
      variation_id: item.variationId,
      quantity: item.quantity
    })),
    shipping_lines: [{
      method_id: checkoutData.shippingMethod.id,
      method_title: checkoutData.shippingMethod.name,
      total: checkoutData.shippingMethod.cost.toString()
    }]
  };

  // POST to WooCommerce REST API
  const response = await wooClient.post('/orders', orderData);
  return response.data;
};
```

**Stripe Integration**
```typescript
// Client-side: Collect payment info
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// In checkout form component
const stripe = useStripe();
const elements = useElements();

const handleSubmit = async (formData: CheckoutFormData) => {
  if (!stripe || !elements) return;

  // Create payment intent on backend
  const { clientSecret } = await fetch('/api/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: cart.total })
  }).then(r => r.json());

  // Confirm payment
  const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: {
      card: elements.getElement(CardElement)!,
      billing_details: {
        name: `${formData.shipping.firstName} ${formData.shipping.lastName}`,
        email: formData.contact.email,
        phone: formData.shipping.phone,
        address: {
          line1: formData.shipping.address1,
          line2: formData.shipping.address2,
          city: formData.shipping.city,
          state: formData.shipping.state,
          postal_code: formData.shipping.postalCode,
          country: formData.shipping.country
        }
      }
    }
  });

  if (error) {
    // Handle error
    showErrorNotification(error.message);
  } else if (paymentIntent.status === 'succeeded') {
    // Create order in WooCommerce
    const order = await createOrder(formData, paymentIntent.id);
    // Redirect to confirmation
    router.push(`/order-confirmation/${order.id}`);
  }
};
```

**Server-side API Route** (`/api/create-payment-intent`)
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

export async function POST(request: Request) {
  const { amount } = await request.json();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'usd',
    automatic_payment_methods: {
      enabled: true
    }
  });

  return Response.json({ clientSecret: paymentIntent.client_secret });
}
```

#### 3.6 Order Confirmation

**Order Confirmation Page** (`/order-confirmation/[orderId]`)

**Page Content**
```
┌────────────────────────────────────────────────┐
│  ✓ Order Confirmed!                            │
│                                                │
│  Thank you for your order!                     │
│  Order #12345                                  │
│                                                │
│  A confirmation email has been sent to:        │
│  customer@example.com                          │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ Order Details                            │ │
│  ├──────────────────────────────────────────┤ │
│  │ Order Number: #12345                     │ │
│  │ Order Date: January 19, 2026             │ │
│  │ Total: $145.80                           │ │
│  │ Payment Method: Visa ending in 4242      │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ Shipping Information                     │ │
│  ├──────────────────────────────────────────┤ │
│  │ John Doe                                 │ │
│  │ 123 Main St                              │ │
│  │ Apt 4B                                   │ │
│  │ New York, NY 10001                       │ │
│  │ United States                            │ │
│  │                                          │ │
│  │ Estimated Delivery: Jan 24-26, 2026      │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ Order Items                              │ │
│  ├──────────────────────────────────────────┤ │
│  │ [img] Product Name                       │ │
│  │       Color: Red, Size: M                │ │
│  │       Qty: 1              $40.00         │ │
│  │                                          │ │
│  │ [img] Another Product                    │ │
│  │       Qty: 2              $80.00         │ │
│  ├──────────────────────────────────────────┤ │
│  │ Subtotal:                 $120.00        │ │
│  │ Shipping:                  $15.00        │ │
│  │ Tax:                       $10.80        │ │
│  │ Total:                    $145.80        │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  [Continue Shopping]  [View Order Details]     │
│                                                │
│  Need help? Contact us at support@maleq.com    │
└────────────────────────────────────────────────┘
```

**Confirmation Email**
- Send via WooCommerce email system
- Order summary
- Tracking information (when available)
- Customer service contact info
- Return policy link

**Post-Order Actions**
- Clear cart
- Store order in user account (if logged in)
- Track conversion in analytics
- Trigger order webhook for fulfillment system

---

### 4. User Account System

#### 4.1 Authentication

**Registration** (`/register`)
- Email address (unique)
- Password (min 8 characters, complexity requirements)
- First name
- Last name
- Terms & privacy policy checkbox
- Email verification (optional)
- CAPTCHA (to prevent bots)

**Login** (`/login`)
- Email/username
- Password
- "Remember me" checkbox
- "Forgot password" link
- Social login options (Google, Facebook - optional)

**Password Reset** (`/forgot-password`)
- Enter email
- Send reset link
- Reset token expires in 24 hours
- Confirmation page

**Integration with WordPress**
```typescript
// Use WordPress REST API authentication
// JWT authentication plugin for headless setup

interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    displayName: string;
  };
}

// Login request
const login = async (email: string, password: string) => {
  const response = await fetch(`${WORDPRESS_URL}/wp-json/jwt-auth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password })
  });

  if (!response.ok) throw new Error('Login failed');

  const data: AuthResponse = await response.json();
  // Store token in httpOnly cookie or localStorage
  return data;
};
```

#### 4.2 Account Dashboard (`/account`)

**Dashboard Home**
- Welcome message: "Hello, John!"
- Recent orders (last 3)
- Account balance/credits (if applicable)
- Wishlist count
- Quick links: Orders, Addresses, Account Details, Wishlist

**Navigation**
- Orders
- Downloads (for digital products)
- Addresses
- Account Details
- Wishlist
- Logout

#### 4.3 Order History (`/account/orders`)

**Order List View**
```
┌───────────────────────────────────────────────────────────────┐
│  Order #12345                     January 19, 2026            │
│  Status: Processing               Total: $145.80              │
│  ───────────────────────────────────────────────────────────  │
│  [img] Product Name × 1                                       │
│  [img] Another Product × 2                                    │
│                                                               │
│  [View Details]  [Track Order]                                │
└───────────────────────────────────────────────────────────────┘
```

**Order Status Types**
- Pending Payment
- Processing
- On Hold
- Completed
- Cancelled
- Refunded
- Failed

**Order Detail View** (`/account/orders/[orderId]`)
- Same as order confirmation page
- Tracking information
- Invoice download (PDF)
- Reorder button
- Cancel order (if pending/processing)
- Request return/refund

#### 4.4 Address Management (`/account/addresses`)

**Default Addresses**
- Billing Address
- Shipping Address

**Address Book**
- Add new address
- Edit address
- Delete address
- Set as default billing/shipping

**Address Form Fields**
- Same as checkout shipping form

#### 4.5 Account Details (`/account/details`)

**Editable Fields**
- First name
- Last name
- Display name
- Email (with verification)
- Phone number
- Password change
- Newsletter subscription preferences

**Privacy & Data**
- Download personal data (GDPR compliance)
- Request account deletion
- Privacy settings

---

### 5. Search & Navigation

#### 5.1 Header Search Bar

**Search Input**
- Prominent placement in header
- Expandable on click (mobile)
- Search icon
- Clear button when text entered
- Keyboard shortcut (Cmd/Ctrl + K)

**Autocomplete/Suggestions**
```typescript
interface SearchSuggestion {
  type: 'product' | 'category' | 'blog';
  id: string;
  name: string;
  image?: string;
  price?: string;
  url: string;
}
```

**Dropdown Content**
- Popular searches (if no input)
- Recent searches (client-side storage)
- Product matches (with thumbnail, price)
- Category matches
- Blog post matches
- "View all results" link

**Implementation**
```typescript
const useSearchAutocomplete = (query: string) => {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const debounceTimeout = setTimeout(async () => {
      setLoading(true);
      const results = await fetchSearchSuggestions(query);
      setSuggestions(results);
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceTimeout);
  }, [query]);

  return { suggestions, loading };
};
```

#### 5.2 Search Results Page (`/search?q=query`)

**Page Layout**
- Search query display: "Search results for: 'dildo'" (123 results)
- Filters (same as shop page)
- Sort options
- Product grid
- Pagination
- Did you mean suggestions (for typos)
- Related searches

**No Results State**
- "No products found for 'xyz'"
- Search suggestions
- Popular categories
- Featured products

#### 5.3 Category Pages (`/shop/category/[slug]`)

**Distinct from General Shop Page**
- Category name as H1
- Category description (if available)
- Category image/banner
- Subcategories grid (if applicable)
- Product count
- Breadcrumbs: Home > Shop > Category Name
- Filters (exclude category filter)
- Products specific to category

**Mega Menu** (Desktop Navigation)
```
Shop ▼
├─ Dildos
│  ├─ Realistic Dildos
│  ├─ Glass Dildos
│  └─ Strap-On Dildos
├─ Vibrators
│  ├─ Bullet Vibrators
│  ├─ Wand Vibrators
│  └─ Rabbit Vibrators
└─ Lubricants
   ├─ Water-Based
   ├─ Silicone-Based
   └─ Hybrid
```

**Mobile Navigation**
- Hamburger menu
- Expandable category tree
- Search bar
- Account links
- Cart link

#### 5.4 Breadcrumbs

**Component**
```typescript
interface BreadcrumbItem {
  label: string;
  href: string;
}

const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => (
  <nav aria-label="Breadcrumb">
    <ol className="flex items-center space-x-2">
      {items.map((item, index) => (
        <li key={item.href} className="flex items-center">
          {index > 0 && <span className="mx-2">/</span>}
          {index === items.length - 1 ? (
            <span className="text-gray-500">{item.label}</span>
          ) : (
            <Link href={item.href}>{item.label}</Link>
          )}
        </li>
      ))}
    </ol>
  </nav>
);
```

**Structured Data**
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://maleq.com"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Shop",
      "item": "https://maleq.com/shop"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "Dildos",
      "item": "https://maleq.com/shop/category/dildos"
    }
  ]
}
```

---

### 6. Product Reviews & Ratings

#### 6.1 Review Display

**Review Summary** (Product Page)
```
★★★★☆ 4.5 out of 5 stars (127 reviews)

Rating Breakdown:
5 stars: ████████████████████░  82% (104)
4 stars: ████░░░░░░░░░░░░░░░░  12% (15)
3 stars: ██░░░░░░░░░░░░░░░░░░   4% (5)
2 stars: ░░░░░░░░░░░░░░░░░░░░   1% (2)
1 star:  █░░░░░░░░░░░░░░░░░░░   1% (1)
```

**Review List**
```typescript
interface ProductReview {
  id: string;
  rating: number; // 1-5
  title?: string;
  content: string;
  author: {
    name: string;
    verified: boolean; // Purchased product
  };
  date: string;
  helpful: number; // Helpful count
  verified: boolean;
}
```

**Review Card**
```
┌───────────────────────────────────────────────┐
│ ★★★★★  Great Product!                         │
│ John D. ✓ Verified Purchase   Jan 15, 2026    │
│ ───────────────────────────────────────────── │
│ This product exceeded my expectations. The    │
│ quality is excellent and shipping was fast.   │
│                                               │
│ Was this helpful?  [👍 Yes (12)]  [👎 No (1)] │
└───────────────────────────────────────────────┘
```

**Review Sorting**
- Most Recent
- Highest Rating
- Lowest Rating
- Most Helpful
- Verified Purchases Only

**Review Filtering**
- By rating (5 stars, 4 stars, etc.)
- Verified purchases only
- With photos/videos

#### 6.2 Write Review Form

**Form Fields**
- Overall rating (1-5 stars, required)
- Review title (optional, max 100 chars)
- Review content (required, min 50 chars, max 5000 chars)
- Upload photos (optional, max 5 images)
- Nickname (optional, default to account name)
- Email (required, for verification)
- Checkbox: I agree to terms and conditions

**Validation**
- Must be logged in (or provide email)
- Can only review after purchase (optional enforcement)
- One review per product per user
- Content moderation (profanity filter)

**Submission Flow**
1. User submits review
2. Review queued for moderation (optional)
3. Email confirmation sent
4. Review published (auto or after approval)
5. User receives notification when published

**WordPress Integration**
```typescript
// Use WordPress Comments API or WooCommerce Product Reviews

const submitReview = async (productId: string, review: ReviewFormData) => {
  const response = await fetch(`${WORDPRESS_URL}/wp-json/wc/v3/products/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      review: review.content,
      reviewer: review.name,
      reviewer_email: review.email,
      rating: review.rating
    })
  });

  return response.json();
};
```

#### 6.3 Review Moderation (Admin)

**Admin Review Queue**
- List of pending reviews
- Approve/reject actions
- Edit review content
- Flag inappropriate reviews
- Respond to reviews (store owner)

---

### 7. Wishlist

#### 7.1 Wishlist Functionality

**Add to Wishlist**
- Heart icon on product cards
- Heart icon on product page
- Toggle state (filled/outline)
- Show notification on add/remove
- Update count in header

**Wishlist Storage**
- Logged-in users: Backend storage (WordPress user meta)
- Guest users: localStorage
- Sync on login

**Wishlist Data Structure**
```typescript
interface Wishlist {
  userId?: string;
  items: WishlistItem[];
  itemCount: number;
}

interface WishlistItem {
  productId: string;
  variationId?: string;
  addedAt: number; // Timestamp
}
```

#### 7.2 Wishlist Page (`/account/wishlist`)

**Page Layout**
```
┌────────────────────────────────────────────────┐
│  My Wishlist (5 items)                         │
│  ────────────────────────────────────────────  │
│  [Share Wishlist] [Clear All]                  │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ [img] Product Name                     × │ │
│  │       $40.00  [In Stock]                  │ │
│  │       [Add to Cart] [Remove]              │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ [img] Another Product                  × │ │
│  │       $60.00  [Out of Stock]              │ │
│  │       [Notify Me] [Remove]                │ │
│  └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

**Features**
- Product thumbnail, name, price
- Stock status
- Add to cart (if in stock)
- Notify when back in stock (if out of stock)
- Remove from wishlist
- Share wishlist (unique URL)
- Move all to cart

**Empty State**
- "Your wishlist is empty"
- "Start adding products you love"
- Featured products

---

### 8. Notifications & Feedback

#### 8.1 Toast Notifications

**Toast Component**
```typescript
interface ToastProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // Auto-dismiss after ms
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Examples
showToast({
  type: 'success',
  message: 'Product added to cart',
  duration: 3000,
  action: {
    label: 'View Cart',
    onClick: () => router.push('/cart')
  }
});

showToast({
  type: 'error',
  message: 'Failed to add product to cart. Please try again.',
  duration: 5000
});
```

**Usage Scenarios**
- Add to cart success/error
- Add to wishlist
- Form submission success/error
- Copy link to clipboard
- Stock alerts
- Login/logout
- Password reset email sent
- Review submitted

**Toast Container**
- Position: Top-right or bottom-center
- Stack multiple toasts
- Swipe to dismiss (mobile)
- Accessibility: aria-live region

#### 8.2 Loading States

**Component-Level Loading**
```typescript
// Skeleton loaders for product cards
<ProductCardSkeleton count={8} />

// Spinner for buttons
<button disabled={isLoading}>
  {isLoading ? <Spinner /> : 'Add to Cart'}
</button>

// Progress bar for image uploads
<ProgressBar progress={uploadProgress} />
```

**Page-Level Loading**
- Top loading bar (NProgress style)
- Suspense boundaries with fallback
- Skeleton screens for major UI sections

**Optimistic Updates**
- Add to cart: Immediately update UI, revert on error
- Wishlist toggle: Instant feedback
- Quantity updates: Immediate with debounced API call

#### 8.3 Error Handling

**Error Boundary Component**
```typescript
class ErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to error reporting service (Sentry, etc.)
    console.error('Error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-page">
          <h1>Oops! Something went wrong</h1>
          <p>We're sorry for the inconvenience. Please try refreshing the page.</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**API Error Handling**
```typescript
interface ApiError {
  status: number;
  message: string;
  code?: string;
}

const handleApiError = (error: ApiError) => {
  switch (error.status) {
    case 400:
      showToast({ type: 'error', message: 'Invalid request. Please check your input.' });
      break;
    case 401:
      showToast({ type: 'error', message: 'Please log in to continue.' });
      router.push('/login');
      break;
    case 404:
      showToast({ type: 'error', message: 'Resource not found.' });
      break;
    case 500:
      showToast({ type: 'error', message: 'Server error. Please try again later.' });
      break;
    default:
      showToast({ type: 'error', message: error.message || 'An unexpected error occurred.' });
  }
};
```

**Form Validation Errors**
- Inline error messages below fields
- Error summary at top of form
- Focus first error field on submit
- Real-time validation on blur

---

### 9. Additional Features

#### 9.1 Product Comparison

**Comparison Table** (`/compare`)
```
┌───────────────────────────────────────────────────────────┐
│  Compare Products                                         │
│  ───────────────────────────────────────────────────────  │
│             Product A    Product B    Product C           │
│  [img]        [img]        [img]        [img]             │
│  Name         Name A       Name B       Name C            │
│  Price        $40.00       $50.00       $45.00            │
│  Rating       ★★★★☆        ★★★★★        ★★★☆☆             │
│  Size         Small        Medium       Large             │
│  Color        Red          Blue         Green             │
│  Material     Silicone     TPE          Glass             │
│  Stock        In Stock     Low Stock    Out of Stock      │
│                                                           │
│  [Add to Cart] [Add to Cart] [Notify Me]                  │
│  [Remove]      [Remove]      [Remove]                     │
└───────────────────────────────────────────────────────────┘
```

**Features**
- Add to comparison from product page
- Compare up to 4 products
- Highlight differences
- Side-by-side attribute comparison
- Add to cart from comparison
- Share comparison (unique URL)

#### 9.2 Recently Viewed Products

**Storage**: localStorage
**Display**: Product page sidebar or footer
**Component**: Horizontal carousel
**Max Items**: Last 10 viewed products
**Exclude**: Current product

#### 9.3 Stock Alerts

**Back in Stock Notifications**
- Email input on out-of-stock product page
- Store email + product ID in database
- Send email when stock updated
- One-time notification, then remove

**Low Stock Warnings**
- Display "Only 3 left!" on product page
- Urgency messaging
- Update in real-time

#### 9.4 Social Proof

**Trust Badges**
- Secure checkout badge
- Money-back guarantee
- Free shipping badge
- Trusted payment methods

**Social Sharing**
- Share product on Facebook, Twitter, Pinterest
- Email product to friend
- Copy link to clipboard

**Live Activity**
- "5 people viewing this product now"
- "12 sold in the last 24 hours"
- "Last purchased 2 hours ago"

#### 9.5 Gift Options

**Gift Wrapping**
- Checkbox on cart/checkout
- Additional fee
- Gift message input

**Gift Cards**
- Purchase gift card product
- Email delivery
- Custom amount
- Apply to order at checkout

#### 9.6 Coupons & Discounts

**Coupon Code Field**
- Cart page
- Checkout page
- Apply/remove functionality

**Discount Types**
- Percentage off (20% off)
- Fixed amount ($10 off)
- Free shipping
- Buy one get one (BOGO)

**Coupon Validation**
```typescript
interface Coupon {
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  amount: number;
  minPurchase?: number;
  expiryDate?: string;
  usageLimit?: number;
  usedCount: number;
  applicableProducts?: string[];
  applicableCategories?: string[];
}

const validateCoupon = async (code: string, cart: Cart): Promise<CouponValidationResult> => {
  // Check if coupon exists
  // Check expiry
  // Check usage limit
  // Check minimum purchase
  // Check applicable products/categories
  // Calculate discount amount
};
```

**Auto-Applied Coupons**
- Banner promotions
- URL parameter (?coupon=SAVE20)
- Automatic best discount selection

#### 9.7 Email Marketing

**Newsletter Signup**
- Footer signup form
- Popup modal (exit intent, time-based)
- Checkbox on registration
- Incentive: 10% off first order

**Transactional Emails**
- Order confirmation
- Shipping confirmation
- Delivery notification
- Review request (7 days after delivery)
- Abandoned cart reminder
- Back-in-stock alert
- Password reset

**Email Service Integration**
- Mailchimp
- SendGrid
- Klaviyo (recommended for e-commerce)

#### 9.8 Analytics & Tracking

**Google Analytics 4**
- Enhanced e-commerce tracking
- Product impressions
- Product clicks
- Add to cart
- Remove from cart
- Checkout steps
- Purchase conversion
- Refunds

**Facebook Pixel**
- ViewContent
- AddToCart
- InitiateCheckout
- Purchase

**Custom Events**
```typescript
// Track add to cart
gtag('event', 'add_to_cart', {
  currency: 'USD',
  value: product.price,
  items: [{
    item_id: product.id,
    item_name: product.name,
    item_category: product.category,
    price: product.price,
    quantity: quantity
  }]
});

// Track purchase
gtag('event', 'purchase', {
  transaction_id: order.id,
  value: order.total,
  currency: 'USD',
  tax: order.tax,
  shipping: order.shipping,
  items: order.items.map(item => ({
    item_id: item.productId,
    item_name: item.name,
    item_category: item.category,
    price: item.price,
    quantity: item.quantity
  }))
});
```

---

## Data Architecture

### API Layer

**GraphQL Endpoints** (Already implemented)
- Products query (with filters, pagination)
- Single product query
- Categories query
- Posts query
- Single post query

**REST API Endpoints** (To be implemented)

```typescript
// Cart API
POST   /api/cart/add              // Add item to cart
DELETE /api/cart/remove/:itemId   // Remove item
PUT    /api/cart/update/:itemId   // Update quantity
GET    /api/cart                  // Get current cart
DELETE /api/cart                  // Clear cart

// Checkout API
POST   /api/checkout/calculate-shipping  // Get shipping rates
POST   /api/checkout/calculate-tax       // Get tax amount
POST   /api/checkout/create-order        // Create WooCommerce order
POST   /api/payment/create-intent        // Create Stripe payment intent

// User API
POST   /api/auth/register         // Register new user
POST   /api/auth/login            // Login
POST   /api/auth/logout           // Logout
POST   /api/auth/refresh          // Refresh auth token
POST   /api/auth/forgot-password  // Request password reset
POST   /api/auth/reset-password   // Reset password

// Wishlist API
POST   /api/wishlist/add          // Add to wishlist
DELETE /api/wishlist/remove/:id   // Remove from wishlist
GET    /api/wishlist              // Get wishlist

// Reviews API
POST   /api/reviews               // Submit review
GET    /api/reviews/:productId    // Get product reviews

// Search API
GET    /api/search/suggest        // Autocomplete suggestions
GET    /api/search                // Full search results

// Stock Alerts API
POST   /api/stock-alerts          // Subscribe to back-in-stock
```

### Database Schema Additions

**Cart Sessions** (if using database storage)
```sql
CREATE TABLE cart_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NULL,
  session_id VARCHAR(255) UNIQUE NOT NULL,
  cart_data JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);
```

**Wishlist** (WordPress user meta or custom table)
```sql
CREATE TABLE wishlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  variation_id INT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY user_product (user_id, product_id, variation_id),
  FOREIGN KEY (user_id) REFERENCES wp_users(ID) ON DELETE CASCADE
);
```

**Stock Alerts**
```sql
CREATE TABLE stock_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  product_id INT NOT NULL,
  variation_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notified BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMP NULL
);
```

**Product Views** (for recently viewed, analytics)
```sql
CREATE TABLE product_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  user_id INT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_product (product_id)
);
```

---

## User Experience & Design

### Design System

#### Color Palette
- Primary: Brand colors (already defined in theme)
- Secondary: Accent colors
- Success: Green (#10B981)
- Warning: Yellow (#F59E0B)
- Error: Red (#EF4444)
- Neutral: Grays for text, borders, backgrounds

#### Typography
- Headings: Already defined
- Body: Readable font size (16px base)
- Product names: Slightly larger, medium weight
- Prices: Bold, prominent
- Labels: Smaller, uppercase for some

#### Spacing
- Consistent padding/margin scale (4px increments)
- Generous whitespace
- Card spacing in grid (gap-4, gap-6)

#### Components
- Buttons: Primary (filled), Secondary (outline), Text
- Inputs: Consistent border, focus states, error states
- Cards: Shadow, hover effects
- Badges: Pill-shaped, color-coded by status
- Icons: Consistent size, stroke width

### Accessibility

**WCAG 2.1 AA Compliance**
- Color contrast ratios (4.5:1 for text)
- Keyboard navigation (tab order, focus indicators)
- ARIA labels for interactive elements
- Alt text for all images
- Form labels and error associations
- Skip to main content link
- Screen reader announcements for dynamic content

**Semantic HTML**
- Proper heading hierarchy (H1 > H2 > H3)
- `<nav>` for navigation
- `<main>` for main content
- `<article>` for products/posts
- `<button>` vs `<a>` (buttons for actions, links for navigation)

**Focus Management**
- Trap focus in modals
- Return focus on modal close
- Focus first error on form submit
- Visible focus indicators

### Responsive Design

**Breakpoints**
```typescript
const breakpoints = {
  sm: '640px',   // Mobile landscape
  md: '768px',   // Tablet
  lg: '1024px',  // Desktop
  xl: '1280px',  // Large desktop
  '2xl': '1536px' // Extra large
};
```

**Mobile-First Approach**
- Base styles for mobile
- Progressive enhancement for larger screens
- Touch-friendly targets (min 44×44px)
- Thumb-zone optimization
- Swipe gestures for galleries

**Layout Adaptations**
- Product grid: 2 → 3 → 4 columns
- Filter panel: Slide-out → Sidebar
- Navigation: Hamburger → Full menu
- Cart summary: Bottom → Right sidebar
- Checkout: Single column → Two columns

---

## Technical Requirements

### Performance

**Core Web Vitals Targets**
- Largest Contentful Paint (LCP): < 2.5s
- First Input Delay (FID): < 100ms
- Cumulative Layout Shift (CLS): < 0.1

**Optimization Strategies**
1. **Image Optimization**
   - Next.js Image component (already using)
   - WebP format with fallbacks
   - Responsive images (srcset)
   - Lazy loading (below fold)
   - Priority loading (above fold)
   - Blur placeholders

2. **Code Splitting**
   - Route-based splitting (automatic with Next.js)
   - Component lazy loading (`React.lazy()`)
   - Dynamic imports for heavy components
   - Vendor bundle optimization

3. **Caching Strategy**
   - Static generation for product pages (ISR)
   - Cache-Control headers
   - CDN caching (Vercel Edge Network)
   - Browser caching (localStorage for cart, wishlist)
   - GraphQL response caching

4. **Data Fetching**
   - Server-side rendering for SEO
   - Prefetch on hover (product cards)
   - Parallel data fetching
   - Debounced search/filter updates
   - Optimistic UI updates

5. **Bundle Size**
   - Tree shaking
   - Import only what's needed
   - Analyze bundle (`next/bundle-analyzer`)
   - Remove unused dependencies

### SEO Requirements

**On-Page SEO**
- Unique title tags (55-60 chars)
- Meta descriptions (150-160 chars)
- H1 tags (one per page)
- Canonical URLs
- Open Graph tags
- Twitter Card tags
- Image alt text
- Semantic HTML

**Product Page SEO**
```typescript
export const metadata: Metadata = {
  title: `${product.name} | Maleq`,
  description: product.shortDescription || stripHtml(product.description).substring(0, 160),
  openGraph: {
    title: product.name,
    description: product.shortDescription,
    images: [{ url: product.image.sourceUrl }],
    type: 'product',
  },
  twitter: {
    card: 'summary_large_image',
    title: product.name,
    description: product.shortDescription,
    images: [product.image.sourceUrl],
  },
};
```

**Structured Data** (Schema.org)
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Product Name",
  "image": "https://example.com/image.jpg",
  "description": "Product description",
  "sku": "SKU123",
  "brand": {
    "@type": "Brand",
    "name": "Manufacturer Name"
  },
  "offers": {
    "@type": "Offer",
    "url": "https://example.com/product",
    "priceCurrency": "USD",
    "price": "39.99",
    "priceValidUntil": "2026-12-31",
    "availability": "https://schema.org/InStock",
    "seller": {
      "@type": "Organization",
      "name": "Maleq"
    }
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.5",
    "reviewCount": "127"
  }
}
```

**XML Sitemap**
- Auto-generate with `next-sitemap`
- Include all products, categories, blog posts
- Update frequency: daily for products, weekly for static pages
- Priority: 1.0 for home, 0.8 for products, 0.6 for blog

**Robots.txt**
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /cart/
Disallow: /checkout/
Disallow: /account/
Disallow: /api/

Sitemap: https://maleq.com/sitemap.xml
```

### Security

**Authentication Security**
- Password hashing (bcrypt, handled by WordPress)
- JWT tokens with expiration
- HTTP-only cookies for tokens
- CSRF protection
- Rate limiting on login attempts
- Two-factor authentication (optional)

**Payment Security**
- PCI DSS compliance (handled by Stripe)
- Never store card details
- Tokenization for payment methods
- SSL/TLS encryption (HTTPS)
- Secure checkout indicators

**API Security**
- Authentication required for sensitive endpoints
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitize HTML output)
- CORS configuration
- Rate limiting

**Data Privacy**
- GDPR compliance
- Cookie consent banner
- Privacy policy
- Data export/deletion requests
- Secure password reset flow
- Email verification

**Content Security Policy (CSP)**
```typescript
// next.config.ts
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' *.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  }
];
```

---

## Performance & SEO

### Monitoring & Analytics

**Tools to Implement**
1. **Google Analytics 4** - User behavior, conversions
2. **Google Search Console** - Search performance, indexing
3. **Lighthouse CI** - Automated performance testing
4. **Sentry** - Error tracking and monitoring
5. **Hotjar/FullStory** - Session recordings, heatmaps (optional)

**Key Metrics to Track**
- Page load times
- Conversion rate
- Cart abandonment rate
- Average order value
- Revenue per visitor
- Bounce rate
- Exit pages
- Search queries
- Product view to purchase ratio

### Internationalization (Future)

**Multi-Language Support**
- English (default)
- Spanish
- French
- (Others as needed)

**Implementation**
- next-intl or next-i18next
- Translation files (JSON)
- Language switcher in header
- URL structure: `/en/`, `/es/`, `/fr/`
- Translated product descriptions (from WooCommerce)

**Multi-Currency** (Future)
- USD (default)
- EUR, GBP, CAD
- Real-time exchange rates
- Currency switcher
- Geolocation-based default

---

## Future Enhancements

### Phase 2 Features

1. **Advanced Personalization**
   - Product recommendations (ML-based)
   - Personalized home page
   - Recently viewed products
   - Browsing history-based suggestions

2. **Loyalty Program**
   - Points for purchases
   - Rewards tiers
   - Referral bonuses
   - Birthday discounts

3. **Subscriptions**
   - Subscribe and save (recurring orders)
   - Manage subscriptions in account
   - Subscription discounts

4. **Live Chat Support**
   - Chat widget (Intercom, Drift, Zendesk)
   - AI chatbot for common questions
   - Human agent escalation

5. **Advanced Search**
   - Visual search (upload image)
   - Voice search
   - AI-powered recommendations

6. **Mobile App**
   - React Native app
   - Push notifications
   - App-exclusive deals

7. **Augmented Reality**
   - AR product preview (for applicable products)
   - Virtual try-on

8. **Social Commerce**
   - Instagram shopping integration
   - Facebook shop
   - TikTok integration

9. **Marketplace Features**
   - Multi-vendor support
   - Vendor dashboards
   - Commission management

10. **Advanced Analytics**
    - Customer lifetime value
    - Cohort analysis
    - Predictive analytics
    - A/B testing framework

---

## Implementation Roadmap

### MVP (Minimum Viable Product) - Phase 1

**Priority 1: Core Shopping (Weeks 1-3)**
1. ✅ Product listing (already implemented)
2. ✅ Product detail pages (already implemented)
3. 🔨 Shopping cart functionality
4. 🔨 Mini cart component
5. 🔨 Cart page
6. 🔨 Add to cart from product page
7. 🔨 Cart persistence (localStorage)

**Priority 2: Checkout Flow (Weeks 4-6)**
1. 🔨 Checkout page (single-page)
2. 🔨 Shipping address form
3. 🔨 Shipping method selection
4. 🔨 Payment integration (Stripe)
5. 🔨 Order creation in WooCommerce
6. 🔨 Order confirmation page
7. 🔨 Confirmation email

**Priority 3: User Account (Weeks 7-8)**
1. 🔨 User registration
2. 🔨 User login/logout
3. 🔨 Account dashboard
4. 🔨 Order history
5. 🔨 Address management
6. 🔨 Account details editing

**Priority 4: Enhanced Discovery (Weeks 9-10)**
1. 🔨 Advanced filters (price, attributes)
2. 🔨 Sort options
3. 🔨 Search autocomplete
4. 🔨 Category pages
5. 🔨 Breadcrumbs
6. 🔨 Mobile navigation menu

### Post-MVP Enhancements - Phase 2

**Priority 5: Product Engagement (Weeks 11-12)**
1. 🔨 Product reviews system
2. 🔨 Write review form
3. 🔨 Rating summary
4. 🔨 Wishlist functionality
5. 🔨 Wishlist page
6. 🔨 Quick view modal

**Priority 6: Marketing & Conversion (Weeks 13-14)**
1. 🔨 Coupon/discount codes
2. 🔨 Newsletter signup
3. 🔨 Email marketing integration
4. 🔨 Related products
5. 🔨 Recently viewed products
6. 🔨 Stock alerts

**Priority 7: Content & Support (Weeks 15-16)**
1. 🔨 About page
2. 🔨 Contact page
3. 🔨 FAQ page
4. 🔨 Shipping & returns policy
5. 🔨 Privacy policy
6. 🔨 Terms & conditions

**Priority 8: Polish & Optimization (Ongoing)**
1. 🔨 Performance optimization
2. 🔨 SEO enhancements
3. 🔨 Accessibility audit
4. 🔨 Analytics implementation
5. 🔨 Error handling improvements
6. 🔨 Loading states refinement

---

## Testing Strategy

### Testing Types

**1. Unit Testing**
- Component tests (React Testing Library)
- Utility function tests (Jest)
- API route tests
- Form validation tests

**2. Integration Testing**
- Cart flow (add, update, remove)
- Checkout flow (address → shipping → payment → order)
- Authentication flow (register, login, logout)
- Product filtering and sorting

**3. End-to-End Testing**
- Cypress or Playwright
- Critical user journeys:
  - Browse → View Product → Add to Cart → Checkout → Order Confirmation
  - Search → Filter → Add to Wishlist
  - Register → Login → View Orders

**4. Performance Testing**
- Lighthouse CI in build pipeline
- Load testing (Artillery, k6)
- Bundle size monitoring

**5. Accessibility Testing**
- Automated: axe-core, WAVE
- Manual: Keyboard navigation, screen reader (NVDA, JAWS)

**6. Visual Regression Testing**
- Percy or Chromatic
- Component Storybook

**7. User Acceptance Testing (UAT)**
- Beta testing with real users
- Feedback collection
- Bug reporting

---

## Deployment & DevOps

### Environments

1. **Development** - Local development
2. **Staging** - Pre-production testing
3. **Production** - Live site

### CI/CD Pipeline

```yaml
# GitHub Actions example
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run lint
      - run: bun run type-check
      - run: bun run test
      - run: bun run build

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          scope: staging

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

### Monitoring

**Error Tracking**
- Sentry for runtime errors
- Error boundaries for React errors
- API error logging

**Performance Monitoring**
- Vercel Analytics
- Google Analytics 4
- Core Web Vitals tracking

**Uptime Monitoring**
- UptimeRobot or Pingdom
- Status page (Statuspage.io)

---

## Documentation

### Developer Documentation
- Setup instructions
- Environment variables
- API documentation
- Component library (Storybook)
- Code style guide
- Git workflow

### User Documentation
- FAQ
- How-to guides
- Shipping & returns
- Privacy policy
- Terms & conditions

---

## Success Metrics

### Business KPIs
- Conversion rate (target: 2-5%)
- Average order value (target: $60+)
- Cart abandonment rate (target: <70%)
- Customer retention rate
- Revenue per visitor

### Technical KPIs
- Page load time (target: <2s)
- Core Web Vitals (all green)
- Uptime (target: 99.9%)
- Error rate (target: <0.1%)
- API response time (target: <500ms)

### User Experience KPIs
- Bounce rate (target: <40%)
- Time on site
- Pages per session
- Mobile conversion rate
- Customer satisfaction score (CSAT)

---

## Conclusion

This specification document provides a comprehensive blueprint for building a robust, modern e-commerce store. The phased approach ensures we deliver core functionality first while planning for future enhancements.

**Next Steps:**
1. Review and approve this specification
2. Set up project management tools (Jira, Linear, GitHub Projects)
3. Create detailed tickets for MVP features
4. Begin Phase 1 implementation
5. Regular stakeholder reviews and iterations

**Key Principles:**
- **User-First**: Every decision prioritizes user experience
- **Performance**: Fast, responsive, optimized
- **Scalability**: Built to grow with the business
- **Security**: Protecting user data and transactions
- **Maintainability**: Clean code, good documentation
