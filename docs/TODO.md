# Male Q Headless - Project TODO

## Priority Legend

- `[HIGH]` - Critical for launch
- `[MED]` - Important but not blocking
- `[LOW]` - Nice to have / polish

---

explore uptimerobot free alternatives (uptime kuma, etc)
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
- [ ] `[HIGH]` Set `ADMIN_API_KEY` environment variable in production (code ready in `lib/api/admin-auth.ts`)
- [ ] `[HIGH]` Submit sitemap to Google Search Console
- [ ] `[HIGH]` Transfer Apple Pay token to new server
- [ ] `[MED]` Do page testing on Safari
- [ ] `[MED]` Set up monitoring and error tracking (Sentry configured)
- [ ] `[MED]` Configure CDN for static assets
- [ ] `[MED]` Set up database backups

---

## Cart & Checkout

- [ ] `[MED]` Update shipping tiers — currently has Standard/Express/Overnight (domestic only); needs international tiers
- [ ] `[MED]` Test contact form functionality (submissions received, spam protection working)

---

## Auth & Account

- [ ] `[MED]` Create login modal overlay
- [ ] `[MED]` When not logged in, clicking "Add to Wishlist" should show login/signup modal instead of adding to wishlist

---

## Product Pages

- [ ] `[MED]` Test product review submission end-to-end
- [ ] `[LOW]` Add product comparison feature
- [ ] `[LOW]` Add returns/RMA request form in account area
- [ ] `[LOW]` Add help center/FAQ integration in account area

---

## Images & Media

- [ ] `[MED]` Re-import product images < 650px onto 650x650 white background (no stretch/crop)
- [ ] `[LOW]` Fix specific variation images:
  - Green variation (9342851003801) images missing for `/product/sensuelle-luna-velvet-touch-vibe` — present in gallery but not attached
  - Green variation (850013016006) image not imported for `/product/cloud-9-health-wellness-borosilicate-kegel-training-set` — purple image attached instead
- [ ] `[LOW]` Add admin feature to assign primary image on product page (similar to edit product button); "Assign Primary Image" swaps displayed image with current primary; supports variable products per-variation

---

## Content & Data

- [ ] `[HIGH]` SEO optimize product descriptions — use info from title, attributes, and reviews to create unique, keyword-rich descriptions; add headers, bullet points, and formatting; insert relevant gallery images
- [ ] `[HIGH]` Populate product reviews (content exists, needs import/display)
- [ ] `[LOW]` Fix product specs not showing on some products (missing brand/attributes from STC import)

### Product Data Cleanup

- [ ] `[MED]` Verify STC product variations created correctly (some show gallery images of other variations but no variation selector)
  - e.g. `/product/lelo-soraya-2-rabbit-massager-rechargeable`, `/product/hunkyjunk-lockdown-chastity`
- [ ] `[MED]` Set `product_source` meta field to `'stc'` for all STC-imported products (GraphQL field ready in mu-plugin)

---

## Technical & Performance

### Security

- [ ] `[MED]` Replace base64 token generation with proper JWT (signed, expiring)
- [ ] `[MED]` Add CAPTCHA to comment box and login pages
- [ ] `[LOW]` Integrate rate limiting into API endpoints (module exists at `lib/api/rate-limit.ts` but not wired into routes)
- [ ] `[LOW]` Move auth token to httpOnly cookies (currently localStorage)
- [ ] `[LOW]` Add CSRF protection on state-changing operations

### Performance

- [ ] `[MED]` Review and improve Core Web Vitals scores (Lighthouse audit)
- [ ] `[MED]` Integrate wsrv.nl (weserv) as free image proxy/CDN — serves WebP/AVIF, resizes on the fly, no signup needed. Wrap image URLs with `https://wsrv.nl/?url=ORIGINAL_URL&w=WIDTH&output=webp`
- [ ] `[LOW]` Add service worker for offline support
- [ ] `[LOW]` Replace order tracking mu-plugin with AST Free WP plugin

---

## Notes

- Main branch: `initial-setup`
- Deployment guide: `docs/DEPLOYMENT_GUIDE.md`
- API documentation: `docs/API_DOCUMENTATION.md`
- Store specifications: `docs/STORE_SPECIFICATIONS.md`
- No `@maleq.com` email references found in codebase (verified 2026-02-09)

---

## Completed

### UX & Bug Fixes (2026-02-12)

- [x] Fix sitemap pagination — now fetches all 25K+ URLs via cursor-based pagination
- [x] Fix add-to-cart limit — clamps quantity to max stock instead of rejecting
- [x] Add +/- quantity selector buttons on product page (replaces number input)
- [x] Add "View Cart" button for 5 seconds after adding item to cart
- [x] Minicart images now link to product page
- [x] Improve create account flow — timeout, better errors, returnTo redirect, password strength indicator
- [x] Login redirects to previously viewed page via `returnTo` param
- [x] Add logout option to navbar account dropdown
- [x] Fix post-logout — redirects to home page, no spinning button
- [x] Fix wishlist back navigation — `router.replace` prevents back-button loops
- [x] Move popup notifications below sticky navbar
- [x] Scroll to top on filter change
- [x] Hide "Write a Review" button when review form is visible
- [x] Fix image cache invalidation — onError fallbacks + reduced cache TTL to 1 day
- [x] Create WPGraphQL query limit mu-plugin (500 max per query)
- [x] Expand price filter ranges ($200-500, $500-1000, $1000+) with "No Max" default
- [x] Scope category filter to subcategories on category pages, "Browse all categories" link
- [x] Add slide-in/out transitions to mobile menu and mobile filter panel
- [x] Create auto-delete product images mu-plugin (featured, gallery, variation)
- [x] Brand/manufacturer filter already functional on category pages (verified)
- [x] Quick view modal already has full image gallery (verified)
- [x] Product prefetch on hover handled by Next.js Link auto-prefetch (verified)
- [x] Create `/public/og-image.jpg` (1200x630px) for social sharing
- [x] Vercel image optimization workaround — `unoptimized: true` configured
- [x] Add shipping "same as billing" selector in user dashboard (account/addresses page)
- [x] Password reset flow — forgot-password and reset-password pages implemented
- [x] Contact form — fully implemented with Zod validation at `/contact`
- [x] Blog category pages (`/guides/category/[slug]`) — implemented with pagination and SEO
- [x] Blog tag pages (`/guides/tag/[slug]`) — implemented with SEO metadata
- [x] ISR revalidation endpoint — on-demand tag/path revalidation at `/api/revalidate`
- [x] Rate limiting module — implemented at `lib/api/rate-limit.ts` (auth: 10/min, forms: 5/min, general: 60/min)
- [x] Sale/discount tier banner — DiscountTierBanner component on product and shop pages

### Security Remediation (2026-02-12)

- [x] Remediate 22 audit findings (C1-C7, H1-H2, H6, H8-H10, M2-M3, M6, M8, M11, L5)

### SEO & Schema (2026-02-09)

- [x] Add BlogPosting JSON-LD schema to blog post pages
- [x] Add ArticleSchema reusable component to `components/seo/StructuredData.tsx`
- [x] Add Twitter Card metadata to all public pages
- [x] Add canonical URLs to all pages
- [x] Add `noindex` to shop search results pages
- [x] Full SEO metadata audit: all pages have title, description, OG, Twitter, canonical

### UI & Styling (2026-02-09)

- [x] Add blog breadcrumbs to blog post and listing pages
- [x] Add product H1 black underline (6px solid, `.heading-plain` opt-out)
- [x] Create DiscountTierBanner component (compact/full variants) on product and shop pages
- [x] Set category thumbnail images for all 217 categories via DB script
- [x] Add `image { sourceUrl }` to GraphQL category query with fallback
- [x] Update breadcrumbs/hero category link styling on blog pages

### Technical & Performance (2026-02-09)

- [x] Add `React.memo` to ProductCard component
- [x] Dynamic import QuickViewModal (`ssr: false`)
- [x] Dynamic import ProductReviews on product page
- [x] Increase minimum password to 12 characters
- [x] Add CSP, HSTS, and Permissions-Policy security headers in next.config.ts

### Code Audit (2026-02-09)

- [x] Replace Apollo Client with graphql-request (~25 kB savings)
- [x] Add admin auth (`ADMIN_API_KEY`) to all 9 sync/admin API routes
- [x] Add token validation to auth mu-plugin endpoints
- [x] Forward Authorization headers in Next.js API proxy routes
- [x] Add `robots: { index: false }` to cart/checkout/account pages
- [x] Add blog posts to sitemap via `GET_ALL_POST_SLUGS`
- [x] Add try-catch to `getBlogPosts()` and `getBlogCategories()`
- [x] Use `Promise.allSettled` for resilient search queries
- [x] Support revalidation secret via header
- [x] Fix related blog articles grid
- [x] Product grids: `auto-fill` with `minmax(256px, 1fr)`
- [x] Replace Fuse.js + simple-spellchecker with MiniSearch
- [x] Fix server-side XSS sanitization (isomorphic-dompurify)
- [x] Create shared DB module (`scripts/lib/db.ts`)
- [x] Shared filter utility (`lib/utils/product-filter-helpers.ts`)
- [x] Remove dead code, move scripts-only deps to devDependencies
- [x] Archive 14 one-time migration scripts
- [x] Fix CSS issues (border-radius, hardcoded colors)

### Product Data (2026-02-07)

- [x] Update STC products with stock count (37,760 updated)
- [x] Add product links to order summary on checkout page
- [x] Round all product prices to .97/.X7 endings
- [x] Add infinite scroll to product category pages with "Load More" fallback
- [x] Fix progress bar on checkout page
- [x] Add sticky "Add to Cart" on product pages

### Features & UI (2026-01-22 – 2026-01-27)

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
- [x] Product pricing with logarithmic markup formula
- [x] Update add_to_cart shortcodes to new product IDs (171 updated)
- [x] Auto-discount functionality (tiered spend thresholds)
- [x] Order tracking page, FAQs page, 404/error pages
- [x] Set in-stock variations as primary variation
- [x] Product gallery single row carousel
- [x] Product card bottom-aligned title/price/CTA
- [x] DidYouMean component with instant search
- [x] Sale badge % off calculation
- [x] Fix variation image loading on initial page load
- [x] Fix Load More button for search results
