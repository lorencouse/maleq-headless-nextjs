# User Acceptance Testing (UAT) Plan

## Overview

This document outlines the User Acceptance Testing plan for the Maleq e-commerce store. UAT ensures the application meets business requirements and provides a good user experience before launch.

---

## Test Environment

- **Staging URL**: [To be configured]
- **Test Accounts**: Create test customer accounts
- **Payment Testing**: Use Stripe test mode with test cards
- **Browser Requirements**: Chrome, Firefox, Safari, Edge (latest versions)
- **Device Requirements**: Desktop, Tablet, Mobile

---

## Test Categories

### 1. User Registration & Authentication

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| UA-001: Register new user | 1. Go to /register<br>2. Fill form with valid data<br>3. Submit | Account created, redirected to account page | ☐ |
| UA-002: Register with existing email | 1. Go to /register<br>2. Use existing email<br>3. Submit | Error message: "Email already exists" | ☐ |
| UA-003: Login with valid credentials | 1. Go to /login<br>2. Enter valid credentials<br>3. Submit | Logged in, redirected to account | ☐ |
| UA-004: Login with invalid credentials | 1. Go to /login<br>2. Enter wrong password<br>3. Submit | Error message displayed | ☐ |
| UA-005: Password reset request | 1. Go to /forgot-password<br>2. Enter email<br>3. Submit | Success message shown | ☐ |
| UA-006: Logout | 1. Click logout<br>2. Confirm | Logged out, session cleared | ☐ |

### 2. Product Browsing

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| PB-001: View shop page | 1. Navigate to /shop | Products displayed in grid | ☐ |
| PB-002: Filter by category | 1. Select category filter<br>2. Apply | Only category products shown | ☐ |
| PB-003: Filter by price range | 1. Set min/max price<br>2. Apply | Products within range shown | ☐ |
| PB-004: Sort products | 1. Select sort option (price, date, etc.) | Products sorted correctly | ☐ |
| PB-005: Search products | 1. Enter search term<br>2. Submit | Relevant products displayed | ☐ |
| PB-006: View product details | 1. Click product card | Product page loads with details | ☐ |
| PB-007: View product images | 1. Click thumbnail images | Main image updates | ☐ |
| PB-008: Quick view modal | 1. Click quick view icon | Modal opens with product info | ☐ |

### 3. Shopping Cart

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| SC-001: Add simple product | 1. Click "Add to Cart" on simple product | Item added, toast shown, cart updates | ☐ |
| SC-002: Add variable product | 1. Select variation<br>2. Click "Add to Cart" | Item with variation added | ☐ |
| SC-003: Add without selecting variation | 1. Click "Add to Cart" without variation | Error: "Please select options" | ☐ |
| SC-004: Update quantity in cart | 1. Go to cart<br>2. Change quantity | Subtotal updates | ☐ |
| SC-005: Remove item from cart | 1. Click remove button | Item removed, totals update | ☐ |
| SC-006: Apply valid coupon | 1. Enter valid coupon code<br>2. Apply | Discount applied, total updates | ☐ |
| SC-007: Apply invalid coupon | 1. Enter invalid code<br>2. Apply | Error message shown | ☐ |
| SC-008: Cart persistence | 1. Add items<br>2. Close browser<br>3. Return | Cart items restored | ☐ |
| SC-009: Mini cart display | 1. Click cart icon | Mini cart opens with items | ☐ |

### 4. Checkout Process

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| CO-001: Access checkout with items | 1. Go to /checkout with cart items | Checkout page loads | ☐ |
| CO-002: Access checkout empty cart | 1. Go to /checkout with empty cart | Redirected to cart page | ☐ |
| CO-003: Fill contact info | 1. Enter email | Email validated, stored | ☐ |
| CO-004: Fill shipping address | 1. Enter all required fields | Address validated | ☐ |
| CO-005: Select shipping method | 1. Choose shipping option | Total updates with shipping | ☐ |
| CO-006: Free shipping threshold | 1. Add items over threshold | Free shipping available | ☐ |
| CO-007: Tax calculation | 1. Enter shipping state | Tax calculated based on state | ☐ |
| CO-008: Complete payment | 1. Enter test card 4242...<br>2. Submit | Payment successful | ☐ |
| CO-009: Payment declined | 1. Enter decline test card | Error message shown | ☐ |
| CO-010: Order confirmation | 1. Complete order | Confirmation page with order details | ☐ |

### 5. User Account

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| AC-001: View account dashboard | 1. Login<br>2. Go to /account | Dashboard with user info | ☐ |
| AC-002: View order history | 1. Go to /account/orders | Orders listed with status | ☐ |
| AC-003: View order details | 1. Click order in history | Full order details shown | ☐ |
| AC-004: Edit profile | 1. Go to /account/details<br>2. Update info<br>3. Save | Changes saved | ☐ |
| AC-005: Change password | 1. Enter current password<br>2. Enter new password<br>3. Save | Password updated | ☐ |
| AC-006: Manage addresses | 1. Go to /account/addresses<br>2. Add/edit address | Address saved | ☐ |
| AC-007: View wishlist | 1. Go to /account/wishlist | Wishlist items displayed | ☐ |
| AC-008: Add to wishlist | 1. Click heart icon on product | Item added to wishlist | ☐ |
| AC-009: Remove from wishlist | 1. Click heart again or remove button | Item removed | ☐ |

### 6. Content Pages

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| CP-001: About page | 1. Navigate to /about | Page loads with content | ☐ |
| CP-002: Contact page | 1. Navigate to /contact | Page loads with form | ☐ |
| CP-003: Submit contact form | 1. Fill contact form<br>2. Submit | Success message shown | ☐ |
| CP-004: FAQ page | 1. Navigate to /faq | Accordions work | ☐ |
| CP-005: Shipping/Returns | 1. Navigate to /shipping-returns | Policy displayed | ☐ |
| CP-006: Privacy Policy | 1. Navigate to /privacy | Policy displayed | ☐ |
| CP-007: Terms of Service | 1. Navigate to /terms | Terms displayed | ☐ |
| CP-008: 404 page | 1. Navigate to /invalid-url | Custom 404 page shown | ☐ |

### 7. Responsive Design

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| RD-001: Mobile navigation | 1. View on mobile<br>2. Open menu | Mobile menu works | ☐ |
| RD-002: Mobile product grid | 1. View shop on mobile | 2-column grid on small screens | ☐ |
| RD-003: Mobile checkout | 1. Complete checkout on mobile | All steps work | ☐ |
| RD-004: Tablet layout | 1. View on tablet | Appropriate layout | ☐ |

### 8. Performance & Accessibility

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| PA-001: Page load speed | 1. Run Lighthouse | Score > 80 | ☐ |
| PA-002: Keyboard navigation | 1. Navigate using Tab key | All elements accessible | ☐ |
| PA-003: Screen reader | 1. Test with screen reader | Content readable | ☐ |
| PA-004: Skip link | 1. Tab on page load | Skip link appears | ☐ |

---

## Test Cards (Stripe Test Mode)

| Card Number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Successful payment |
| 4000 0000 0000 0002 | Card declined |
| 4000 0000 0000 9995 | Insufficient funds |
| 4000 0027 6000 3184 | Requires authentication |

Use any future expiry date and any 3-digit CVC.

---

## Bug Reporting

When reporting bugs, include:

1. **Test Case ID**: e.g., SC-001
2. **Environment**: Browser, device, OS
3. **Steps to Reproduce**: Detailed steps
4. **Expected Result**: What should happen
5. **Actual Result**: What actually happened
6. **Screenshots/Videos**: If applicable
7. **Severity**: Critical / High / Medium / Low

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| QA Lead | | | |
| Developer | | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-19 | Dev Team | Initial version |
