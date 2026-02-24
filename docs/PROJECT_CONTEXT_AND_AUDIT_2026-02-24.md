# Male Q Project Context + Audit Handoff

Last updated: 2026-02-24 (US)

## Purpose

This document preserves operational context and the current prioritized audit findings so work can continue after conversation compaction/session resets.

## Project Snapshot

- Project: Headless WooCommerce (WordPress backend + Next.js frontend)
- Repo: `/Users/lorencouse/Documents/Development/NextJS/maleq-headless-nextjs`
- Primary architecture doc: `docs/ARCHITECTURE.md`
- Frontend domain: `https://maleq.com`
- WordPress/API domain: `https://wp.maleq.com`
- Frontend host: Coolify VPS (`deploy@46.224.227.119`)
- WordPress/CloudPanel host: WP VPS (`root@159.69.220.162`)

## Data Source Guardrail (Performance-Critical)

- Primary rule: product/catalog data must stay **MySQL-direct first**; GraphQL is fallback only.
- Production expectation: `DATA_SOURCE=auto` (not `graphql`).
- GraphQL-only mode is incident fallback, not normal operation.
- Current production model: app DB user (`maleq_readonly`) has read access to `maleq-wp` plus least-privilege writes on app-owned operational tables only.
- Applied grants (2026-02-24): `maleq_newsletter_subscribers` (`INSERT,UPDATE`), `maleq_push_subscriptions` (`INSERT,UPDATE,DELETE`), `maleq_stock_alert_products` (`INSERT,UPDATE,DELETE`), `maleq_event_log` (`INSERT`).
- Code paths enforcing this:
  - `app/page.tsx` (home product grid source selection)
  - `app/shop/page.tsx` (shop listing source selection)
  - `app/api/products/route.ts` (API MySQL-first path)
  - `lib/products/product-service.ts` (slug fetch MySQL-first, GraphQL fallback)
  - `lib/products/combined-service.ts` (category/brand/filter loaders prefer MySQL when reachable)
  - `app/sex-toys/[slug]/page.tsx` (category page MySQL-first with GraphQL fallback)

## Domain/Service Routing (Current)

- `maleq.com` -> Next.js frontend (Coolify/Traefik)
- `wp.maleq.com` -> WordPress (CloudPanel/Nginx)
- `admin.maleq.com` -> Coolify admin
- `panel.maleq.com` -> CloudPanel login (WP server), protected by HTTP basic auth
- `status.maleq.com` -> Uptime endpoint, protected by HTTP basic auth

## Security/Monitoring Notes

- Production headers include CSP and permissions policy in `next.config.ts`.
- Current live header value includes:
  - `permissions-policy: ... payment=(self "https://js.stripe.com" "https://hooks.stripe.com")`
  - CSP allows Stripe + GA + Cloudflare insights connect/script domains.
- `panel.maleq.com` and `status.maleq.com` currently return `401` by design (auth gate).
- `wp.maleq.com/graphql` health should be monitored using POST GraphQL query, not plain GET semantics.

## Highest-Impact Findings (Open)

1. Complete KPI baseline capture window:
   - Confirm GA4 receives full funnel events in live mode (`view_item` through `purchase`).
   - Confirm admin durable event stream is monitored (`/api/admin/events`).
   - Plan: `docs/KPI_BASELINE_PLAN.md`.

## Secondary Findings (Open)

- Keep analytics env canonical in production (`NEXT_PUBLIC_GA_ID` as primary, avoid conflicting IDs).
- Add regression tests for analytics emission and cart stock validation contract when test bandwidth allows.

## Execution Order (Business Impact First)

1. Capture KPI baseline and verify GA4 funnel continuity.
2. Validate admin event stream and alert thresholds.
3. Add targeted regression tests for analytics + cart stock contract.

## Progress Completed In This Session (2026-02-24)

- Fixed cart stock revalidation contract handling:
  - `components/pwa/CartStockRevalidation.tsx` now supports top-level and legacy nested `stockStatus`.
- De-duplicated GA pageview emission:
  - `components/analytics/GoogleAnalytics.tsx` sets `send_page_view: false`.
  - `lib/analytics/gtag.ts` now emits explicit `page_view` event payloads.
- Adjusted permissions policy for Stripe wallet compatibility:
  - `next.config.ts` payment policy now allows Stripe origins.
- Added baseline anti-abuse guard for payment intent creation:
  - `app/api/payment/create-intent/route.ts` now enforces trusted origin/referrer and stricter amount/currency validation.
  - Additional hardening added: per-IP/user-agent rate limiting, customer email validation, and metadata sanitization before Stripe API call.
- Improved product-by-id API caching behavior:
  - `app/api/products/[id]/route.ts` now sets cache headers for success and 404 responses.
  - Product miss handling hardened: known GraphQL "no product exists" cases now return 404 instead of 500 when index fallback also misses.
  - Data-source order updated for performance: `/api/products/[id]` now uses MySQL/index first and only falls back to GraphQL.
- Integrated newsletter subscribe endpoint with persistence + provider sync:
  - `app/api/newsletter/subscribe/route.ts` now validates JSON/email, applies rate limiting, persists subscribers, and logs durable events.
  - `lib/newsletter/subscription-service.ts` adds `maleq_newsletter_subscribers` upsert flow plus optional Mailchimp/webhook sync.
- Added newsletter degrade-safe behavior for read-only DB:
  - Endpoint returns user success even if local DB persistence is unavailable, and logs `newsletter_subscribe_unpersisted` for operational follow-up.
- Production spot-check:
  - `https://maleq.com/api/products/{id}` now returns `200` for previously failing cart IDs.
  - `permissions-policy` header now includes Stripe wallet origins in production.
  - `POST /api/newsletter/subscribe` returns `200` and now persists rows in `maleq_newsletter_subscribers` (verified).
- Launch readiness checks completed:
  - SSL/domain validated for `maleq.com`, `wp.maleq.com`, `panel.maleq.com`, `status.maleq.com` (valid certificates + expected HTTPS status codes).
  - `ADMIN_API_KEY` verified as configured in production (`/api/admin/events` returns `401 Unauthorized` for invalid key instead of config error).
  - Static asset CDN behavior verified (`/_next/static/*` served via Cloudflare with `cf-cache-status: HIT` and one-year immutable cache headers).
- Uptime Kuma monitor configuration finalized:
  - `CloudPanel - panel.maleq.com (Expected 401)` now treats `401` as UP.
  - `Status - status.maleq.com (Expected 401)` created and treats `401` as UP.
  - `WPGraphQL API (POST assert __typename)` uses POST body assertion and validates as UP.
- Checkout conversion UX update:
  - `components/checkout/OrderSummary.tsx` now links product images to product pages (name links already existed).
- Contact form hardening + validation:
  - `app/api/contact/route.ts` now enforces route-level rate limiting.
  - Production check: valid submission returns `200`; burst invalid probes produce `429` throttles in addition to validation `400`s.
- Checkout shipping tiers expanded to international:
  - Added shared shipping config at `lib/checkout/shipping-rates.ts`.
  - `components/checkout/ShippingMethod.tsx` now switches between domestic and international methods based on selected country.
  - `components/checkout/ExpressCheckout.tsx` now offers country-aware Stripe shipping rates and supports international shipping countries.
  - `components/checkout/ShippingAddressForm.tsx` now supports international country selection and province/region inputs.
- Auth-gated wishlist UX:
  - Added `components/auth/AuthRequiredModal.tsx`.
  - `components/wishlist/WishlistButton.tsx` now blocks guest wishlist actions and opens a login/signup modal overlay instead.
- UAT harness updates:
  - `playwright.config.ts` supports `PLAYWRIGHT_SKIP_WEBSERVER=1` for running tests against deployed environments.
  - `e2e/shop.spec.ts` product URL assertion updated to match `/product/*` route structure.
- Category entity rendering fix (pending production verification after deploy):
  - `lib/db/category-loader.ts` now decodes HTML entities for category names from MySQL loaders.
  - `lib/products/combined-service.ts` now decodes category names in GraphQL paths and bumped category cache keys (`product-categories-v2`, `hierarchical-categories-v3`) to flush stale encoded names.

## Quick Verification Commands

Run from local terminal (with existing SSH access):

```bash
# panel/status auth gates (expected 401)
ssh root@159.69.220.162 "curl -sS -I https://panel.maleq.com/login | sed -n '1,16p' | sed 's/\r$//'"
ssh deploy@46.224.227.119 "curl -sS -I https://status.maleq.com | sed -n '1,16p' | sed 's/\r$//'"

# GraphQL health (recommended monitor pattern)
ssh root@159.69.220.162 "curl -sS -H 'content-type: application/json' --data '{\"query\":\"{__typename}\"}' https://wp.maleq.com/graphql"

# Product ID endpoint spot-check
ssh deploy@46.224.227.119 "for id in 193481 550240 551884 189933 201835; do echo ==\$id==; curl -sS -o /tmp/p.\$id -w 'code=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' https://maleq.com/api/products/\$id; head -c 180 /tmp/p.\$id; echo; done; rm -f /tmp/p.*"
```

## Required Env Variables (Names Only)

- Analytics: `NEXT_PUBLIC_GA_ID` (or `NEXT_PUBLIC_GA_TRACKING_ID`, but prefer one canonical var)
- Admin auth: `ADMIN_API_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- WP/API: `NEXT_PUBLIC_WORDPRESS_API_URL`, `WOOCOMMERCE_URL`
- Optional cron/admin: `CRON_SECRET`
- Newsletter (optional provider sync):
  - Mailchimp: `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER_PREFIX` (or API key suffix autodetect)
  - Generic webhook: `NEWSLETTER_WEBHOOK_URL`, `NEWSLETTER_WEBHOOK_BEARER_TOKEN`
  - Provider selection (optional): `NEWSLETTER_PROVIDER` = `mailchimp` | `webhook` | `none`

## Working Rule for Future Sessions

- Always prefer `docs/TODO.md` "Audit-Driven Execution Board (2026-02-24)" as the active execution queue.
- Update that checklist immediately after each production-impacting fix.
- KPI baseline/instrumentation reference: `docs/KPI_BASELINE_PLAN.md`.
- Uptime monitor configuration reference: `docs/UPTIME_KUMA_MONITOR_RUNBOOK.md`.
