# KPI Baseline + Instrumentation Plan (Male Q)

Last updated: 2026-02-24

## Scope

This plan is tied to current production implementation in:

- GA4 client tracking: `lib/analytics/gtag.ts`
- GA bootstrap + pageview behavior: `components/analytics/GoogleAnalytics.tsx`
- Web Vitals emission: `components/analytics/WebVitals.tsx`
- Server-side durable events: `lib/monitoring/durable-events.ts`
- Checkout/order/stripe event producers:
  - `app/api/payment/create-intent/route.ts`
  - `app/api/orders/create/route.ts`
  - `app/api/stripe/webhook/route.ts`
- Funnel summary endpoint:
  - `app/api/admin/events/summary/route.ts`

## 1) Baseline Metrics to Capture (Daily)

### A. Conversion funnel (server truth)

Pull daily from:

- `GET /api/admin/events/summary?sinceHours=24`

Track:

- `checkoutIntentCreated`
- `checkoutOrderCreated`
- `stripePaymentSucceeded`
- `checkoutIntentFailed`
- `checkoutOrderCreateFailed`
- `checkoutOrderValidationFailed`
- `checkoutOrderAmountMismatch`
- `checkoutOrderPaymentIncomplete`
- `stripePaymentFailed`
- `stripePaymentFailedUnmatched`

Derived rates:

- `intentToOrderPct`
- `orderToPaidWebhookPct`
- `intentToPaidWebhookPct`

### B. Frontend funnel (GA4)

Expected ecommerce events (already instrumented in code):

- `view_item`
- `add_to_cart`
- `view_cart`
- `begin_checkout`
- `add_shipping_info`
- `add_payment_info`
- `purchase`

Pageview source is deduped via explicit `page_view` event.

### C. Performance

From GA4 custom events emitted by `WebVitals.tsx`:

- `LCP`
- `CLS`
- `INP`
- `FCP`
- `TTFB`

### D. SEO health

From server durable events summary:

- `seo.top404Paths` (top broken paths/hits)

From GSC UI/API:

- indexed pages
- coverage issues
- CTR / average position for top landing pages

## 2) Target Metrics (First 30-45 Days)

### Core Web Vitals (mobile-first)

- LCP: <= 2.5s (p75)
- INP: <= 200ms (p75)
- CLS: <= 0.1 (p75)
- FCP: <= 1.8s (p75)
- TTFB: <= 800ms (p75)

### Funnel

- add_to_cart -> begin_checkout: >= 35%
- begin_checkout -> purchase: >= 35%
- view_item -> purchase: trend up week-over-week
- unmatched/failed stripe webhooks: <= 1% of successful intents

### SEO

- 404 hit volume trending down week-over-week
- zero persistent indexability blockers on money pages
- stable/improving non-brand CTR on top category/product URLs

## 3) Instrumentation Plan

### Already implemented

- GA4 ecommerce + pageview + web vitals in:
  - `lib/analytics/gtag.ts`
  - `components/analytics/GoogleAnalytics.tsx`
  - `components/analytics/WebVitals.tsx`
- Durable backend event log + summaries in:
  - `lib/monitoring/durable-events.ts`
  - `app/api/admin/events/route.ts`
  - `app/api/admin/events/summary/route.ts`

### Required GA4 property configuration (UI)

- Mark `purchase` as key event.
- Mark `begin_checkout` as key event.
- Keep DebugView enabled during QA only.
- Create funnel exploration:
  - `view_item -> add_to_cart -> begin_checkout -> add_shipping_info -> add_payment_info -> purchase`

### Required ops automation

- Daily cron/job to snapshot:
  - `/api/admin/events/summary?sinceHours=24`
  - export to sheet/db with date stamp
- Repo automation script:
  - `scripts/ops/snapshot-kpi.ts`
  - `bun run kpi:snapshot`
- Weekly review for:
  - top checkout errors
  - top 404 paths
  - conversion step drop-offs

## 4) Validation Checklist (Per Release)

- [ ] `page_view` appears once per route change in GA4 DebugView.
- [ ] `view_item`, `add_to_cart`, `begin_checkout`, `purchase` fire with correct values.
- [ ] `checkout_intent_created` increments on payment intent create.
- [ ] `stripe_payment_succeeded` increments after webhook delivery.
- [ ] `/api/admin/events/summary` returns non-empty funnel data.
- [ ] top 404 list in summary endpoint updates after a forced 404 test.
- [ ] Web Vitals events (`LCP`, `INP`, `CLS`) are visible in GA4 events report.

## 5) Pull Commands

```bash
# 24h funnel + error/seo summary
curl -H "Authorization: Bearer <ADMIN_API_KEY>" \
  "https://maleq.com/api/admin/events/summary?sinceHours=24"

# raw recent events
curl -H "Authorization: Bearer <ADMIN_API_KEY>" \
  "https://maleq.com/api/admin/events?limit=100&sinceHours=24&includePayload=1"
```

```bash
# Save local snapshot JSON (summary only)
ADMIN_API_KEY='<ADMIN_API_KEY>' bun run kpi:snapshot

# Save summary + raw events
ADMIN_API_KEY='<ADMIN_API_KEY>' KPI_INCLUDE_EVENTS=1 bun run kpi:snapshot
```

```bash
# Example daily cron at 09:05 UTC
5 9 * * * cd /path/to/maleq-headless-nextjs && ADMIN_API_KEY='<ADMIN_API_KEY>' bun run kpi:snapshot >> /var/log/maleq-kpi-snapshot.log 2>&1
```
