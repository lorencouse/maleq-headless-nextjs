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

1. Cart out-of-stock revalidation mismatch:
   - Client checks `data.product.stockStatus` while API returns top-level `stockStatus`.
   - File: `components/pwa/CartStockRevalidation.tsx`
   - API: `app/api/products/[id]/route.ts`

2. GA pageview duplication:
   - Initial `gtag('config', ...)` pageview plus route-change pageview path.
   - Files: `components/analytics/GoogleAnalytics.tsx`, `lib/analytics/gtag.ts`

3. Wallet/payment policy risk:
   - `payment=(self)` may interfere with wallet flows in embedded/checkout contexts.
   - File: `next.config.ts`

4. Payment intent endpoint exposed:
   - `POST /api/payment/create-intent` currently has no auth/anti-abuse gate.
   - File: `app/api/payment/create-intent/route.ts`

5. Newsletter conversion leakage:
   - Subscribe endpoint returns success but does not persist to ESP or DB.
   - File: `app/api/newsletter/subscribe/route.ts`

## Secondary Findings (Open)

- `/api/products/[id]` fallback/caching can still produce fragile behavior in upstream faults.
- Need stronger KPI instrumentation and clean baseline process for GA4/GSC/Stripe.
- Add regression tests for analytics emission and cart stock validation contract.

## Execution Order (Business Impact First)

1. Fix cart stock revalidation contract.
2. Remove GA pageview duplication.
3. Verify wallet checkout behavior + adjust permissions policy if needed.
4. Protect payment-intent creation endpoint from abuse.
5. Integrate newsletter endpoint with ESP + persistence.
6. Harden product-by-id API fallback + cache behavior.
7. Finalize monitoring checks (auth-aware and GraphQL POST health).
8. Complete KPI baseline + dashboard validation checklist.

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
- Integrated newsletter subscribe endpoint with persistence + provider sync:
  - `app/api/newsletter/subscribe/route.ts` now validates JSON/email, applies rate limiting, persists subscribers, and logs durable events.
  - `lib/newsletter/subscription-service.ts` adds `maleq_newsletter_subscribers` upsert flow plus optional Mailchimp/webhook sync.
- Added newsletter degrade-safe behavior for read-only DB:
  - Endpoint returns user success even if local DB persistence is unavailable, and logs `newsletter_subscribe_unpersisted` for operational follow-up.
- Production spot-check:
  - `https://maleq.com/api/products/{id}` now returns `200` for previously failing cart IDs.
  - `permissions-policy` header now includes Stripe wallet origins in production.
  - `POST /api/newsletter/subscribe` returns `200` and now persists rows in `maleq_newsletter_subscribers` (verified).

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
