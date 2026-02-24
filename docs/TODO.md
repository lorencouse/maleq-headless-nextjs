# Male Q Headless - Project TODO

- [ ] `[MED]` Verify &amp; entity fix visible on production after next deploy (patch merged in `152e5a0`; verify at https://maleq.com/sex-toys/bondage-fetish-kink once Coolify rollout completes)

~~fix/remove &AMP; artifacts in products/DB~~ — DONE (local + production, `scripts/fix-html-entities.ts`)

~~Fix bug with N/A sale price on shop/filtered pages~~ — DONE (index-loader now reads `_regular_price`/`_sale_price` from postmeta)


## Priority Legend

- `[HIGH]` - Critical for launch
- `[MED]` - Important but not blocking
- `[LOW]` - Nice to have / polish

---

## Audit-Driven Execution Board (2026-02-24)

Source: production architecture + code review for performance, SEO, conversion, and reliability.

- [x] `[HIGH]` Fix cart stock revalidation contract mismatch (`components/pwa/CartStockRevalidation.tsx` vs `/api/products/[id]`)
- [x] `[HIGH]` De-duplicate GA4 pageview tracking (single pageview emission path)
- [x] `[HIGH]` Review/adjust `Permissions-Policy` for checkout wallet compatibility (`payment` policy) — verified in production header (`payment=(self "https://js.stripe.com" "https://hooks.stripe.com")`)
- [x] `[HIGH]` Add auth/anti-abuse guard on `POST /api/payment/create-intent` — trusted origin/referrer validation, amount/currency checks, customerEmail validation, metadata sanitization, and IP/user-agent rate limiting
- [x] `[HIGH]` Integrate newsletter subscribe endpoint with ESP (Klaviyo/Mailchimp/etc.) + persistence (DB-backed `maleq_newsletter_subscribers` + provider sync support for Mailchimp/webhook, durable-event logging, route rate limit, graceful fallback if DB writes unavailable)
- [x] `[HIGH]` Grant least-privilege DB write access for app-owned tables to frontend DB user (`maleq_readonly`) so newsletter/push/event logs persist in production (granted on `maleq_newsletter_subscribers`, `maleq_push_subscriptions`, `maleq_stock_alert_products`; verified newsletter row insert)
- [x] `[MED]` Harden `/api/products/[id]` fallback/caching behavior for cart reliability — response cache headers added and GraphQL/product-miss fallback normalized to 404 (reduces cart-related 500s)
- [x] `[MED]` Update Uptime Kuma checks:
  - `panel.maleq.com` and `status.maleq.com`: expected-401 checks configured and validating as UP
  - `wp.maleq.com/graphql`: POST monitor with GraphQL body assertion configured and validating as UP
  - Runbook: `docs/UPTIME_KUMA_MONITOR_RUNBOOK.md`
- [x] `[MED]` Implement KPI baseline instrumentation plan (GA4 funnel + server-side durable event metrics) — see `docs/KPI_BASELINE_PLAN.md`

Reference context for future compacted sessions: `docs/PROJECT_CONTEXT_AND_AUDIT_2026-02-24.md`

---

- [x] Auto-populate logged-in users' contact form (name/email) when available
- [x] Add product links to order summary images on checkout page (name + image now link to product)
- [ ] Add image to add-on complete kit product

## Pre-Launch Checklist

- [ ] `[HIGH]` Complete UAT testing (see `docs/UAT_TEST_PLAN.md`; Chromium production smoke is green locally `15/15`; complete after first successful CI WebKit run from `.github/workflows/uat-smoke.yml`, which now auto-runs on `main` pushes)
- [x] `[HIGH]` Verify all payment flows work correctly
  - Test Stripe live mode with real cards
  - Verify order confirmation emails
  - Test failed payment handling
- [x] `[HIGH]` Test and fix login/signup flows before launch
  - Verify email verification works
  - Test password reset flow end-to-end
  - Check session persistence across pages
- [x] `[HIGH]` Test email notifications (order confirmation, password reset)
- [x] `[HIGH]` Verify SSL and domain configuration (validated cert + HTTPS responses for `maleq.com`, `wp.maleq.com`, `panel.maleq.com`, `status.maleq.com` on 2026-02-24)
- [x] `[HIGH]` Set `ADMIN_API_KEY` environment variable in production (verified via `/api/admin/events` unauthorized response path)
- [x] `[HIGH]` Submit sitemap to Google Search Console (submitted to GSC and Bing)
- [x] `[HIGH]` Transfer Apple Pay token to new server
- [ ] `[MED]` Do page testing on Safari (run via CI WebKit in `uat-smoke.yml`; local WebKit launch is unstable on current host environment)
- [x] `[MED]` Set up monitoring — Uptime Kuma running at `http://159.69.220.162:3001` (Docker on Hetzner VPS)
- [x] `[MED]` Configure CDN for static assets (Cloudflare serving `/_next/static/*` with `cache-control: public,max-age=31536000,immutable` and `cf-cache-status: HIT`)
- [x] `[MED]` Set up database backups

---

## Cart & Checkout

- [x] `[MED]` Update shipping tiers — domestic + international shipping methods now supported in checkout and Stripe Express flows
- [x] `[MED]` Test contact form functionality (submissions return success; burst probe confirms `429` rate-limit responses)

---

## Auth & Account

- [x] `[MED]` Create login modal overlay
- [x] `[MED]` When not logged in, clicking "Add to Wishlist" shows login/signup modal instead of adding to wishlist

---

## Product Pages

- [x] `[MED]` Test product review submission end-to-end (validated live via `POST /api/reviews` on 2026-02-24, received `201` with review `id=2424`, then deleted via WooCommerce API cleanup)
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

- [x] `[LOW]` ~~Integrate rate limiting into API endpoints~~ — wired into middleware for auth, form, payment, search routes (in-memory, sufficient for current scale)
- [x] `[LOW]` Add token expiry to existing auth system (already enforced server-side in `wordpress/mu-plugins/maleq-auth-endpoints.php` via `maleq_auth_token_expires` with 24h TTL and expiry cleanup in `maleq_validate_token()`)
- [ ] `[LOW]` Add CAPTCHA to login/review forms (only if bot abuse observed)

### Performance

- [ ] `[MED]` Review and improve Core Web Vitals scores (Lighthouse audit)
- [ ] `[MED]` Integrate wsrv.nl (weserv) as free image proxy/CDN — serves WebP/AVIF, resizes on the fly, no signup needed. Wrap image URLs with `https://wsrv.nl/?url=ORIGINAL_URL&w=WIDTH&output=webp`
- [x] `[LOW]` Add service worker for offline support (already present; install precache hardened to avoid `Cache.addAll` failure)
- [ ] `[LOW]` Replace order tracking mu-plugin with AST Free WP plugin

---

## Notes

- Main branch: `initial-setup`
- Deployment guide: `docs/DEPLOYMENT_GUIDE.md`
- API documentation: `docs/API_DOCUMENTATION.md`
- Store specifications: `docs/STORE_SPECIFICATIONS.md`
- No `@maleq.com` email references found in codebase (verified 2026-02-09)

### Server Access (Hetzner VPS)

- **Host**: `159.69.220.162` (`ubuntu-4gb-nbg1-1`, Ubuntu 22.04, 4GB RAM)
- **SSH**: `ssh hetzner` (alias configured in `~/.ssh/config`)
- **SSH key**: `~/.ssh/id_ed25519` (passphrase-protected, stored in macOS Keychain)
- **Firewall**: UFW active — ports 22, 80, 443, 3001, 8433-8443
- **fail2ban**: active on sshd — home IP whitelisted
- **Docker**: installed, running Uptime Kuma on port 3001

**To use SSH with Claude Code from a new machine:**

1. Copy `~/.ssh/id_ed25519` and `~/.ssh/id_ed25519.pub` to the new machine
2. Add the key to macOS Keychain: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`
3. Add this to `~/.ssh/config`:
   ```
   Host hetzner
       HostName 159.69.220.162
       User root
       Port 22
       IdentityFile ~/.ssh/id_ed25519
       UseKeychain yes
       AddKeysToAgent yes
       IdentitiesOnly yes
   ```
4. If connection is refused, your IP may be banned by fail2ban. Use the Hetzner web console (dashboard > server > Console tab) to unban: `fail2ban-client set sshd unbanip YOUR_IP` and whitelist: `fail2ban-client set sshd addignoreip YOUR_IP`
5. The passphrase **must** be loaded in the agent — Claude Code cannot enter passphrases interactively

---

## Completed

### UX & Blog Improvements (2026-02-13)

- [x] Add floating table of contents to blog posts — sticky sidebar on desktop (xl+), collapsible accordion on mobile, highlights active section on scroll
- [x] Filter non-EN articles from main guides page — excludes `espanol` and `cn` categories via `categoryNotIn` GraphQL filter, added language links at top of page
- [x] Keep filter bar visible when no products found — brand and category pages now always render ShopPageClient so filters remain accessible
- [x] Trigger infinite scroll loading earlier — increased IntersectionObserver rootMargin from 400px to 1200px
- [x] Fix product reviews submission — API response format mismatch (`data.data` vs `data.reviews`)
- [x] Add product view count tracking — mu-plugin tracks views, REST endpoint for trending products
- [x] Popularity scoring — composite score: views + (purchases _ 10) + (reviews _ 10), used for Trending section and "Most Popular" sort
- [x] Fix category filter race condition — added AbortController to cancel stale fetch requests
- [x] Add "Show featured sections" button on shop page when hero/featured content is hidden
- [x] Scope category filter to subcategories on category pages, "Browse all categories" link

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
