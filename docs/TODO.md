# Male Q Headless - Project TODO

## Priority Legend

- `[HIGH]` - Critical for launch
- `[MED]` - Important but not blocking
- `[LOW]` - Nice to have / polish

---

## Pre-Launch Checklist

- [ ] `[HIGH]` Complete UAT testing (see `docs/UAT_TEST_PLAN.md`)
- [ ] `[HIGH]` Verify all payment flows work correctly
  - Test Stripe live mode with real cards
  - Verify order confirmation emails
  - Test failed payment handling
- [ ] `[HIGH]` Test and fix login/signup flows before launch
  - Verify email verification works
  - Test password reset flow end-to-end
  - Check session persistence across pages
- [ ] `[HIGH]` Test email notifications (order confirmation, password reset)
- [ ] `[HIGH]` Verify SSL and domain configuration
- [ ] `[HIGH]` Set `ADMIN_API_KEY` environment variable in production
- [ ] `[HIGH]` Create `/public/og-image.jpg` (1200x630px) for social sharing
- [ ] `[HIGH]` Submit sitemap to Google Search Console
- [ ] `[MED]` Set up monitoring and error tracking (Sentry configured)
- [ ] `[MED]` Configure CDN for static assets
- [ ] `[MED]` Set up database backups

---

## Content & Data

~~resolve missing blog post: /best-dildo-for-women~~ DONE - was a draft in old-v1-db (not published), imported as draft ID 594126. All 283 published posts were already imported correctly. 71 draft/private posts exist in old-db.sql if needed (use `bun scripts/import-draft-posts.ts --list-drafts`).
address maleq-link-fix-applied.json broken links

### Product Content

- [ ] `[HIGH]` SEO optimize product descriptions - use information from product title, attributes, and reviews to create unique, keyword-rich descriptions for each product (pull info from product CSV or XML if needed). Add headers, bullet points, and formatting for readability. Insert relevant images where appropriate from product gallery.
- [ ] `[HIGH]` Populate product reviews (content exists, needs import/display)
- [ ] `[MED]` Migrate product photos from old DB descriptions to wp gallery
- [ ] `[MED]` Re-import product images < 650px onto 650x650 white background (no stretch/crop)
- [ ] `[MED]` Add additional datafeeds from STC
- [ ] `[MED]` Manually add missing product 'kits' before deploy
- [ ] `[MED]` Verify all blog post images are migrated
- [ ] `[MED]` Import hotlinked blog/product images to local hosting
- [ ] `[MED]` Update `.product-specs` blocks in blog posts to 2-column tables
- [ ] `[LOW]` Fix product specs not showing on some products (data quality
      issue - missing brand/attributes from STC import)
- [x] Update STC products with stock count (stc_stock_count meta for MUFFS, \_stock for STC-only) — 37,760 updated
- [x] Add product links to order summary on checkout page

import images from reusable blocks into media library and update URLs in blocks to point to local media (currently hotlinked from old site, some missing). Do this after all short codes are updated to new product IDs, and old product images are removed.

pink variation (9342851003818) images were added correctly in gallery during last failed import, but still missing green variation (9342851003801) images. Green variation images are still present in gallery after cleanup, but not attached to gallery: http://localhost:3000/product/sensuelle-luna-velvet-touch-vibe

green variation (850013016006) image not imported. Purple image attached. http://localhost:3000/product/cloud-9-health-wellness-borosilicate-kegel-training-set

Add a feature where admin can assign a products primary image on the product page, similar to how we have the edit product button. Idealy the button would be 'Assign Primary Image' and would assign the currently displayed image as the primary image for the product, and move the current primary to the gallery. If it is a variable product, it would assign the image to the currently selected variation.

### Product Data Cleanup

- [ ] `[MED]` Verify STC product variations created correctly (some show gallery images of other variations, but no variation selector)
  - e.g. `/product/lelo-soraya-2-rabbit-massager-rechargeable`, `/product/hunkyjunk-lockdown-chastity`
- [ ] `[MED]` Set `product_source` meta field to `'stc'` for all STC-imported products
- [x] `[MED]` Round all product prices to .97 regular / .X7 sale endings. Update import script to do this automatically for new products.

- [ ] `[MED]` Review and update reusable blocks with correct URLs

---

## Checkout & Payments

- [ ] `[MED]` Update shipping tiers (Free and express domestic, Standard and express international)
- [ ] `[MED]` Test contact form functionality (submissions received, spam protection working)
- [x] `[MED]` Add infinite scroll to product category pages with "Load More" button fallback
- [x] `[MED]` Fix progress bar on checkout page (not progressing to shipping/payment steps)
- [x] `[MED]` Add sticky "Add to Cart" on product pages for all screen sizes

---

## UI & Styling

- [x] `[MED]` Update breadcrumbs/hero category link styling on blog pages to match product page breadcrumb style.
- [x] `[MED]` Finish setting category images for all product categories - use image from a product from said category, preferably from Brand: XR Brands, with a photo with a human, or human skin tone if possible. if this is too hard to search for, simply add any image from the product gallery of a product in that category.
- [ ] `[LOW]` Improve mobile menu animations and transitions
- [x] `[LOW]` Add bolded black font accents for emphasis
      create sale block on product pages and store pages with spend $100 save $10, spend $200 save $25, spend $300 save $50
      add black underline to product page H1, similar to other header underlines

---

## Product Features

- [ ] `[LOW]` Add product comparison feature
- [ ] `[LOW]` Add returns/RMA request form in account area
- [ ] `[LOW]` Add help center/FAQ integration in account area
      add brand/manufacture product filter on product category page filter sidebar.

---

## Blog & Content Pages

- [ ] `[MED]` Test blog category pages (`/blog/category/[slug]`) - pagination and filtering
- [ ] `[MED]` Test blog tag pages (`/blog/tag/[slug]`) - SEO metadata
- [x] `[LOW]` Add Article/BlogPosting JSON-LD schema on blog post pages

---

## Technical & Performance

### Security Hardening

- [ ] `[MED]` Replace base64 token generation with proper JWT (signed, expiring)
- [x] `[MED]` Increase minimum password requirement to 12 characters
- [ ] `[LOW]` Add rate limiting on login/password reset/forms
- [ ] `[LOW]` Move auth token to httpOnly cookies (currently localStorage)
- [ ] `[LOW]` Add CSRF protection on state-changing operations
- [x] `[LOW]` Add Content-Security-Policy and other security headers via next.config.ts

### Performance

- [ ] `[MED]` Review and improve Core Web Vitals scores (Lighthouse audit)
- [x] `[MED]` Add `React.memo` to ProductCard (BlogCard is a server component, memo N/A)
- [x] `[LOW]` Add dynamic imports for QuickViewModal (ssr: false) and ProductReviews
- [x] `[LOW]` Reviewed large components (ShopPageClient, SearchAutocomplete) - well-structured, splitting would add prop-drilling without benefit
- [ ] `[LOW]` Add service worker for offline support
- [ ] `[LOW]` Implement product data prefetching on hover
- [ ] `[LOW]` Replace order tracking mu-plugin with AST Free WP plugin

### WordPress

- [ ] `[MED]` Auto-delete product images when product deleted in WooCommerce (including variation/gallery images)

---

## SEO

- [x] `[HIGH]` Complete full SEO audit before launch
  - [x] All pages have meta titles and descriptions
  - [x] Structured data: Organization, WebSite, Product, BlogPosting, BreadcrumbList, FAQ
  - [x] Open Graph tags on all public pages
  - [x] Twitter Card metadata on all public pages
  - [x] Canonical URLs on all pages
  - [ ] Create `/public/og-image.jpg` (1200x630px) - default OG image referenced but file missing
  - [x] Search results pages set to `noindex`

---

## Notes

- Main branch: `initial-setup`
- Deployment guide: `docs/DEPLOYMENT_GUIDE.md`
- API documentation: `docs/API_DOCUMENTATION.md`
- Store specifications: `docs/STORE_SPECIFICATIONS.md`
- No `@maleq.com` email references found in codebase (verified 2026-02-09)

---

## Completed

### SEO & Schema (2026-02-09)

- [x] Add BlogPosting JSON-LD schema to blog post pages (headline, author, dates, keywords, articleSection)
- [x] Add ArticleSchema reusable component to `components/seo/StructuredData.tsx`
- [x] Add Twitter Card metadata to all public pages (home, shop, blog, brands, categories, tags)
- [x] Add canonical URLs to all pages (product-category, brand, blog/category, blog/tag, shop, static pages)
- [x] Add `noindex` to shop search results pages
- [x] Full SEO metadata audit: all pages now have title, description, OG, Twitter, canonical

### UI & Styling (2026-02-09)

- [x] Add blog breadcrumbs to blog post and listing pages
- [x] Add product H1 black underline (6px solid, `.heading-plain` opt-out)
- [x] Create DiscountTierBanner component (compact/full variants) on product and shop pages
- [x] Set category thumbnail images for all 217 categories via DB script (XR Brands preferred)
- [x] Add `image { sourceUrl }` to GraphQL category query, `getCategoryImage()` falls back to WP image

### Technical & Performance (2026-02-09)

- [x] Add `React.memo` to ProductCard component for list re-render prevention
- [x] Dynamic import QuickViewModal (`ssr: false`) - only loads when opened
- [x] Dynamic import ProductReviews on product page (code-split below-fold content)
- [x] Increase minimum password to 12 characters (Zod schema, reset page, API route, WP mu-plugin)
- [x] Add CSP, HSTS, and Permissions-Policy security headers in next.config.ts

### Code Audit (2026-02-09)

- [x] Replace Apollo Client with graphql-request (~25 kB bundle savings)
- [x] Add admin auth (`ADMIN_API_KEY`) to all 9 sync/admin API routes
- [x] Add token validation to auth mu-plugin endpoints (`maleq_authenticate_request()`)
- [x] Forward Authorization headers in Next.js API proxy routes
- [x] Add `robots: { index: false }` to cart/checkout/account pages
- [x] Add blog posts to sitemap via `GET_ALL_POST_SLUGS`
- [x] Add try-catch to `getBlogPosts()` and `getBlogCategories()`
- [x] Use `Promise.allSettled` for resilient blog and product search queries
- [x] Support revalidation secret via header in addition to query param
- [x] Fix related blog articles (3 columns, proper responsive grid)
- [x] Product grids: `auto-fill` with `minmax(256px, 1fr)` across all pages
- [x] Replace Fuse.js + simple-spellchecker with MiniSearch (~15 kB savings)
- [x] Fix server-side XSS sanitization (dompurify -> isomorphic-dompurify)
- [x] Create shared DB module for CLI scripts (`scripts/lib/db.ts`)
- [x] Shared filter utility (`lib/utils/product-filter-helpers.ts`)
- [x] Remove dead code (`lib/api/http-client.ts`, `app/blog/[slug]/post.css`)
- [x] Move scripts-only deps to devDependencies, remove `fast-xml-parser`
- [x] Archive 14 one-time migration scripts to `scripts/archive/`
- [x] Fix CSS issues (border-radius, hardcoded colors -> CSS variables)

### Features & UI (2026-01-22 - 2026-01-27)

- [x] Core e-commerce (cart, checkout, Stripe)
- [x] User authentication (login, register, password reset)
- [x] Product catalog with filtering and search
- [x] Blog system with WordPress integration
- [x] Wishlist, stock alerts, newsletter signup
- [x] Mobile responsive design, light/dark theme
- [x] Google Analytics integration
- [x] SEO sitemap and structured data
- [x] Product import from Williams Trading
- [x] Navigation dropdowns with mega menu
- [x] Product page trust badges
- [x] Home page redesign (hero, benefits, newsletter, featured categories, trending carousel)
- [x] Product pricing with logarithmic markup formula (.97/.X7 endings)
- [x] Update add_to_cart shortcodes to new product IDs (171 updated)
- [x] Auto-discount functionality (tiered spend thresholds)
- [x] Order tracking page
- [x] FAQs page with real content
- [x] 404 and error page designs
- [x] Set in-stock variations as primary variation
- [x] Product gallery single row carousel
- [x] Product card bottom-aligned title/price/CTA
- [x] DidYouMean component with instant search
- [x] Sale badge % off calculation
- [x] Fix variation image loading on initial page load
- [x] Fix Load More button for search results
