# Male Q Headless - Project TODO

## Priority Legend

- `[HIGH]` - Critical for launch
- `[MED]` - Important but not blocking
- `[LOW]` - Nice to have / polish

---

## Navigation & Header

### Navbar Updates

- [x] `[HIGH]` Implement dropdown menus for main navigation categories (Completed 2025-01-22)
- [x] `[MED]` Add SVG icons next to navigation text links (Completed 2025-01-22)
- [ ] `[MED]` Update header styling with heavy black underlines
- [ ] `[LOW]` Add bolded black font accents for emphasis

### Planned Navigation Structure

```
Guides
├── Health
├── Sex
├── Relationships
└── News

Shop
├── Returns
├── Help Center
└── Order Tracking

Sex Toys
├── Female Toys
├── Male Toys
├── Cock Rings
├── Male Masturbators
├── Anal Sex Toys
└── Dildos

Bondage
├── Hoods & Masks
├── Cock and Ball Gear
├── Cuffs
├── Gags & Muzzles
└── Sex Swings & Machines

Lube & Essentials
├── Water-Based
├── Silicone-Based
├── Anal
├── Oil-Based
└── Condoms

Account
```

---

## UI & Styling

- [ ] `[MED]` Update breadcrumbs styling across site
- [ ] `[MED]` Add black as a secondary accent color throughout site
- [ ] `[LOW]` Improve mobile menu animations and transitions

---

## Product Pages

### Trust Badges & Info

- [x] `[HIGH]` Add "Discreet Shipping" badge/section (Completed 2025-01-22)
- [x] `[HIGH]` Add "Secure Checkout" trust badge (Completed 2025-01-22)
- [x] `[MED]` Add shipping time estimate badge (Completed 2025-01-22)
- [x] `[MED]` Add quality guarantee badge (Completed 2025-01-22)
- [x] `[LOW]` Add satisfaction guarantee section (Completed 2026-01-25)

### Product Features

- [ ] `[MED]` Add product add-ons functionality (batteries, accessories, etc.)
- [x] `[MED]` Set in-stock variations as primary variation automatically (Completed 2026-01-25)
- [ ] `[LOW]` Add product comparison feature

---

## Content & SEO

### Product Content

- [ ] `[HIGH]` SEO optimize product descriptions
- [ ] `[HIGH]` Add missing category hero images
- [ ] `[MED]` Migrate product photos from old DB descriptions to gallery
- [ ] `[MED]` Auto-match migrated images with new products

### Reviews

- [ ] `[HIGH]` Populate product reviews (content exists, needs import/display)
- [x] ~~Clean up duplicate comments in database~~ (Completed 2025-01-22)

### Blog & Guides

- [ ] `[MED]` Verify all blog post images are migrated
- [ ] `[LOW]` Add related posts section to blog articles

---

## WordPress & Data

- [x] `[HIGH]` Update block product URLs to use new domain paths (Completed 2026-01-23 - migration scripts)
- [x] `[HIGH]` Adopt WordPress-style URLs in Next.js (Completed 2026-01-23 - /product/{slug}, /product-category/{slug})
- [ ] `[MED]` Review and update reusable blocks with correct URLs

---

## Home Page

- [x] `[HIGH]` Create improved home page design with better UX (Completed 2025-01-22)
- [x] `[MED]` Add featured categories section with icons (Completed 2025-01-22)
- [x] `[MED]` Add testimonials/reviews section (Completed 2026-01-25)
- [x] `[MED]` Add "Why Shop With Us" benefits section (Completed 2025-01-22)
- [x] `[LOW]` Add trending products carousel (Completed 2026-01-25)
- [x] `[LOW]` Add blog posts preview section (Completed 2025-01-22)

---

## Account & User Features

- [x] `[LOW]` Add order tracking page with live status (Completed 2026-01-25)
- [ ] `[LOW]` Add returns/RMA request form
- [ ] `[LOW]` Add help center/FAQ integration in account area

---

## Technical & Performance

- [ ] `[MED]` Audit and optimize image loading (lazy loading, WebP)
- [ ] `[MED]` Review and improve Core Web Vitals scores
- [ ] `[LOW]` Add service worker for offline support
- [ ] `[LOW]` Implement product data prefetching on hover

---

## Pre-Launch Checklist

- [ ] `[HIGH]` Complete UAT testing (see docs/UAT_TEST_PLAN.md)
- [ ] `[HIGH]` Security audit review (see docs/SECURITY_AUDIT.md)
- [ ] `[HIGH]` Verify all payment flows work correctly
- [ ] `[HIGH]` Test email notifications (order confirmation, password reset)
- [ ] `[HIGH]` Verify SSL and domain configuration
- [ ] `[MED]` Set up monitoring and error tracking (Sentry configured)
- [ ] `[MED]` Configure CDN for static assets
- [ ] `[MED]` Set up database backups
- [x] `[LOW]` Create 404 and error page designs (Completed 2026-01-25)

---

## Completed Items

- [x] Core e-commerce functionality (cart, checkout, Stripe)
- [x] User authentication system (login, register, password reset)
- [x] Product catalog with filtering and search
- [x] Blog system with WordPress integration
- [x] Wishlist functionality
- [x] Reviews system (UI complete, needs content)
- [x] Stock alert subscriptions
- [x] Newsletter signup
- [x] Mobile responsive design
- [x] Light/dark theme toggle
- [x] Google Analytics integration
- [x] SEO sitemap and structured data
- [x] Product import from Williams Trading
- [x] Category icons configuration
- [x] Delete duplicate comments script (2025-01-22)
- [x] Navigation dropdowns with mega menu (2025-01-22)
- [x] Mobile menu with hierarchical navigation (2025-01-22)
- [x] Product page trust badges component (2025-01-22)
- [x] Home page redesign with new hero, benefits, newsletter (2025-01-22)
- [x] Featured categories on home page (2025-01-22)
- [x] MQ branding with "Men's Questions, Answered" tagline (2025-01-22)
- [x] Promo/Sale banner component (2025-01-22)
- [x] Mr. Q / Miss Q guide sections (2025-01-22)
- [x] Social media and YouTube section (2025-01-22)
- [x] Remove 'Skip to Main Content' link from header (2025-01-22)
- [x] Update favicon paths and site.webmanifest (2025-01-22)
- [x] Change site title to Male Q (2025-01-22)
- [x] Fix navigation dropdown layout and red hover states (2025-01-22)
- [x] Fix mobile menu not opening (2025-01-22)
- [x] Product pricing with logarithmic markup formula (2026-01-24)
- [x] Psychological pricing (.97 regular, .X7 sale endings) (2026-01-24)
- [x] Wholesale price display in WooCommerce admin (2026-01-24)
- [x] Price update script: `scripts/update-prices.ts` (2026-01-24)

---

## Authentication & User Flows

- [ ] `[HIGH]` Test and fix login/signup flows before launch
  - Verify email verification works
  - Test password reset flow end-to-end
  - Check session persistence across pages
- [ ] `[HIGH]` Remove all @maleq.com email mentions before going live
  - Direct users to contact page instead
  - Update email templates if any exist
- [ ] `[MED]` Test contact us form functionality
  - Verify form submissions are received
  - Check spam protection is working

---

## Checkout & Payments

- [ ] `[HIGH]` Test checkout with real payment methods
  - Test Stripe live mode with real cards
  - Verify order confirmation emails
  - Test failed payment handling
- [x] `[MED]` Add auto-discount functionality for threshold-based discounts (Completed 2026-01-25)
  - Spend $100, get $10 off
  - Spend $150, get $15 off
  - Spend $200, get $25 off
  - Upsell messaging shows how much more to spend for next tier
- [ ] `[MED]` Update shipping tiers
  - Review current shipping rates
  - Configure weight-based or price-based tiers

---

## Blog & Content Pages

- [ ] `[MED]` Implement and test blog category pages
  - Verify `/blog/category/[slug]` routes work
  - Check pagination and filtering
- [ ] `[MED]` Implement and test blog tag pages
  - Verify `/blog/tag/[slug]` routes work
  - Ensure proper SEO metadata
- [x] `[MED]` Update FAQs page with real content (Completed 2026-01-25)
  - Shipping FAQs included
  - Returns/refund FAQs included
  - Product care FAQs added

---

## Product Data & Pricing

- [x] `[HIGH]` Update product prices with markup formula (Completed 2026-01-24)
  - Logarithmic curve: 3x at ≤$5 → 2.1x at ≥$100
  - Regular prices end in .97 (psychological pricing)
  - Sale prices end in .67/.77/.87/.97
  - Sale price is 10% off regular price
  - Script: `scripts/update-prices.ts`
- [ ] `[HIGH]` Update add_to_cart shortcodes to new product IDs
  - Find all shortcodes in WordPress content
  - Map old IDs to new IDs
  - Run update script
- [ ] `[MED]` Add additional datafeeds from STC
  - Identify available feeds
  - Create import scripts
- [ ] `[MED]` Manually add missing product 'kits' before deploy
  - Identify kit products not in datafeed
  - Create manually in WooCommerce

---

## Bug Fixes

- [x] `[HIGH]` Fix variation image not loading on initial product page load (Completed 2026-01-25)
  - Initialize variation image in ProductDetailsWrapper
  - Default to first in-stock variation with image
- [ ] `[MED]` Fix product specs styling not showing on some products
  - Identify affected products
  - Debug conditional rendering logic

---

## SEO & Launch Prep

- [ ] `[HIGH]` Complete full SEO audit before launch
  - Check all meta titles and descriptions
  - Verify structured data (JSON-LD)
  - Test Open Graph tags
  - Submit sitemap to Google Search Console
  - Check canonical URLs

---

## Notes

- Main branch: `initial-setup`
- Deployment guide: `docs/DEPLOYMENT_GUIDE.md`
- API documentation: `docs/API_DOCUMENTATION.md`
- Store specifications: `docs/STORE_SPECIFICATIONS.md`


- Add add-on kit missing image
fix product gallery images to be single row carrosel 
On product cards, make title, price, and add to cart section float to bottom of card

