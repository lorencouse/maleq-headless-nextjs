# Deployment Guide

This guide covers deploying the Maleq headless e-commerce store to **Coolify** (self-hosted, on the Coolify VPS at `46.224.227.119`). The Next.js app is built from the GitHub repo via Nixpacks (no `Dockerfile` in the repo) and served behind Coolify's bundled Traefik reverse proxy.

> **Note:** This project is deployed on a self-hosted Coolify instance, **not** Vercel. There is no `vercel.json` and no Vercel-managed cron or analytics — the equivalents are handled by Coolify (build variables, scheduled tasks) and Traefik (TLS), as described below.

---

## Prerequisites

- Access to the Coolify dashboard for the project (Coolify VPS `46.224.227.119`; SSH access is `deploy@46.224.227.119`, **not** root)
- GitHub repository connected to the Coolify application (deploys from `main`)
- WooCommerce/WordPress backend set up
- Stripe account (production keys for live)
- Domain name configured (DNS pointed at the Coolify VPS; TLS issued automatically by Traefik/Let's Encrypt)

---

## WordPress Custom Plugins (Required)

The following mu-plugins must be installed on the WordPress/WooCommerce backend for full functionality.

### Location
Copy these files to: `wp-content/mu-plugins/`

### Required Plugins

| Plugin File | Description | Source |
|-------------|-------------|--------|
| `wpgraphql-brands.php` | Exposes WooCommerce Brands taxonomy to GraphQL | `wordpress-snippets/register-brands-wpgraphql.php` |
| `wpgraphql-materials.php` | Creates Product Materials taxonomy for filtering | `wordpress-snippets/register-material-wpgraphql.php` |
| `wpgraphql-increase-limit.php` | Increases WPGraphQL max query limit from 100 to 500 | `wordpress-snippets/wpgraphql-increase-limit.php` |
| `wpgraphql-render-blocks.php` | Renders Gutenberg blocks (including reusable blocks) in GraphQL content | `wordpress-snippets/wpgraphql-render-blocks.php` |
| `maleq-relative-urls.php` | Converts URLs to relative paths for database portability across environments | `wordpress-snippets/relative-urls.php` |
| `wholesale-price-display.php` | Displays wholesale price in WooCommerce product/variation edit panels | `wordpress/mu-plugins/wholesale-price-display.php` |
| `maleq-auth-endpoints.php` | Authentication endpoints for login, Google sign-in, password reset, and token validation | `wordpress/mu-plugins/maleq-auth-endpoints.php` |
| `maleq-graphql-title-search.php` | Adds titleSearch parameter to WPGraphQL for searching posts by title only | `wordpress/mu-plugins/maleq-graphql-title-search.php` |
| `maleq-order-tracking.php` | Order tracking management with admin UI, REST API, and customer email notifications | `wordpress/mu-plugins/maleq-order-tracking.php` |
| `maleq-stock-sync.php` | Bulk stock sync endpoints for daily cron (stock-mapping + stock-update) | `wordpress/mu-plugins/maleq-stock-sync.php` |
| `maleq-stock-priority.php` | Orders products with in-stock items first, prioritizes WT/manual over STC sources | `wordpress/mu-plugins/maleq-stock-priority.php` |
| `maleq-graphql-product-source.php` | Exposes `_product_source` meta as `productSource` field in WPGraphQL | `wordpress/mu-plugins/maleq-graphql-product-source.php` |
| `maleq-cache-revalidation.php` | Triggers Next.js cache revalidation on product create/update/delete/stock changes | `wordpress/mu-plugins/maleq-cache-revalidation.php` |
| `maleq-graphql-query-limit.php` | Increases WPGraphQL max query amount to 500 for sitemap generation | `wordpress/mu-plugins/maleq-graphql-query-limit.php` |
| `maleq-cleanup-product-images.php` | Auto-deletes product images (featured, gallery, variation) when product is permanently deleted | `wordpress/mu-plugins/maleq-cleanup-product-images.php` |
| `maleq-product-views.php` | Tracks product view counts via REST API and exposes `viewCount` field in WPGraphQL | `wordpress/mu-plugins/maleq-product-views.php` |
| `maleq-push-notifications.php` | Sends Web Push notifications for order status changes and back-in-stock products | `wordpress/mu-plugins/maleq-push-notifications.php` |
| `maleq-product-video.php` | Adds MP4 video meta field to WooCommerce products (media library picker) | `wordpress/mu-plugins/maleq-product-video.php` |
| `maleq-post-product-relations.php` | Adds a "Related Products & Categories" meta box to the post editor; stores ordered-CSV relations in post meta (`_maleq_related_products`, `_maleq_related_product_cats`) that the frontend reads via SQL. Requires WooCommerce. | `wordpress/mu-plugins/maleq-post-product-relations.php` |
| `maleq-post-translations.php` | Adds a "Translations" meta box to the post editor to link a guide to its sibling-language versions (English ⇄ Español ⇄ 中文 ⇄ 日本語). Stores a symmetric CSV in post meta (`_maleq_translations`) that the frontend reads via SQL to render a language switcher + hreflang tags. Language is derived from the post's top-level language category (`en`/`espanol`/`cn`/`日本語-japanese`). | `wordpress/mu-plugins/maleq-post-translations.php` |
| `maleq-brand-meta.php` | Adds a manufacturer website URL + product-URL template to the `product_brand` taxonomy edit screen (termmeta `maleq_brand_website`, `maleq_brand_product_url_template`) and a per-product manufacturer-page override field on the WooCommerce product editor (postmeta `_maleq_mfr_url`). The frontend reads these via SQL to show the brand's "Official website" link and a per-SKU "View on manufacturer's site" link. Requires WooCommerce. | `wordpress/mu-plugins/maleq-brand-meta.php` |

### Installation Steps

1. **Copy plugin files** to WordPress mu-plugins directory:
   ```bash
   # From project root
   cp wordpress-snippets/register-brands-wpgraphql.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-brands.php
   cp wordpress-snippets/register-material-wpgraphql.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-materials.php
   cp wordpress-snippets/wpgraphql-increase-limit.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-increase-limit.php
   cp wordpress-snippets/wpgraphql-render-blocks.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-render-blocks.php
   cp wordpress-snippets/relative-urls.php /path/to/wordpress/wp-content/mu-plugins/maleq-relative-urls.php
   cp wordpress/mu-plugins/wholesale-price-display.php /path/to/wordpress/wp-content/mu-plugins/wholesale-price-display.php
   cp wordpress/mu-plugins/maleq-auth-endpoints.php /path/to/wordpress/wp-content/mu-plugins/maleq-auth-endpoints.php
   cp wordpress/mu-plugins/maleq-graphql-title-search.php /path/to/wordpress/wp-content/mu-plugins/maleq-graphql-title-search.php
   cp wordpress/mu-plugins/maleq-order-tracking.php /path/to/wordpress/wp-content/mu-plugins/maleq-order-tracking.php
   cp wordpress/mu-plugins/maleq-stock-sync.php /path/to/wordpress/wp-content/mu-plugins/maleq-stock-sync.php
   cp wordpress/mu-plugins/maleq-stock-priority.php /path/to/wordpress/wp-content/mu-plugins/maleq-stock-priority.php
   cp wordpress/mu-plugins/maleq-graphql-product-source.php /path/to/wordpress/wp-content/mu-plugins/maleq-graphql-product-source.php
   cp wordpress/mu-plugins/maleq-cache-revalidation.php /path/to/wordpress/wp-content/mu-plugins/maleq-cache-revalidation.php
   cp wordpress/mu-plugins/maleq-product-views.php /path/to/wordpress/wp-content/mu-plugins/maleq-product-views.php
   cp wordpress/mu-plugins/maleq-push-notifications.php /path/to/wordpress/wp-content/mu-plugins/maleq-push-notifications.php
   cp wordpress/mu-plugins/maleq-product-video.php /path/to/wordpress/wp-content/mu-plugins/maleq-product-video.php
   cp wordpress/mu-plugins/maleq-post-product-relations.php /path/to/wordpress/wp-content/mu-plugins/maleq-post-product-relations.php
   cp wordpress/mu-plugins/maleq-post-translations.php /path/to/wordpress/wp-content/mu-plugins/maleq-post-translations.php
   cp wordpress/mu-plugins/maleq-brand-meta.php /path/to/wordpress/wp-content/mu-plugins/maleq-brand-meta.php
   ```

   > **Backfilling existing translations:** after installing `maleq-post-translations.php`, run
   > `bun run scripts/backfill-post-translations.ts --local` to propose original↔translation
   > pairings (review `scripts/output/translation-proposals.json`), then `--apply --local` to write
   > the high-confidence groups. Follow with `wp cache flush` so WordPress's object cache reloads the
   > new post-meta. Remaining pairs are linked by hand via the editor meta box.

2. **Run material migration** (one-time setup):

   **Option A - SQL Migration (Recommended for large sites):**
   ```bash
   mysql -u [user] -p [database] < wordpress-snippets/migrate-materials.sql
   ```
   This script creates terms, normalizes names, and links products in one operation.

   **Option B - PHP Migration (for smaller sites):**
   - Visit: `https://your-wordpress-site.com/wp-admin/?migrate_materials=1`
   - This processes products in batches via the admin interface

3. **Verify GraphQL queries work**:
   ```graphql
   # Test brands
   { productBrands(first: 10) { nodes { id name slug count } } }

   # Test materials
   { productMaterials(first: 10) { nodes { id name slug count } } }
   ```

4. **Configure cache revalidation** (add to `wp-config.php`):
   ```php
   define('MALEQ_FRONTEND_URL', 'https://your-frontend-domain.com');
   define('MALEQ_REVALIDATION_SECRET', 'same-value-as-REVALIDATION_SECRET-env-var');
   ```

### Notes
- mu-plugins load automatically without activation
- These plugins require WPGraphQL and WooGraphQL to be installed
- After deployment, clear any GraphQL/object caches

### Relative URLs System

The `maleq-relative-urls.php` plugin makes the WordPress database portable across environments:

**How it works:**
- WordPress stores all URLs as relative paths (e.g., `/wp-content/uploads/...`, `/product/...`)
- Next.js `rewriteWordPressUrls()` function converts them to absolute URLs at runtime using `NEXT_PUBLIC_IMAGE_BASE_URL`

**One-time migration** (if existing content has absolute URLs):
```bash
# From project root - converts existing URLs in database
bun scripts/convert-urls-to-relative.ts --execute
```

**Local development:**
Set in `.env.local`:
```
NEXT_PUBLIC_IMAGE_BASE_URL=http://maleq-local.local
```

**Production:**
Either set `NEXT_PUBLIC_IMAGE_BASE_URL=https://www.maleq.com` in Coolify, or omit it (defaults to `https://www.maleq.com`). Because this is a `NEXT_PUBLIC_*` variable it is inlined at build time — set it as a **build variable** in Coolify, not a runtime-only env var (see [Environment Variables](#environment-variables)).

---

## Environment Variables

Configure these in the Coolify dashboard → your application → **Environment Variables**.

> **Build-time vs runtime (important on Coolify):** any variable prefixed `NEXT_PUBLIC_` is inlined into the client bundle during `bun run build`. In Coolify these must be marked as **Build Variables** (available as build args), otherwise they will be empty in the browser even if set as runtime env vars. Server-only secrets (e.g. `STRIPE_SECRET_KEY`, `MALEQ_GOOGLE_AUTH_SECRET`, `WOOCOMMERCE_CONSUMER_SECRET`) only need to be runtime variables. After changing any build variable you must **trigger a new deploy** so it gets baked in.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_WORDPRESS_API_URL` | WordPress GraphQL endpoint | `https://your-wp-site.com/graphql` |
| `NEXT_PUBLIC_SITE_URL` | Production site URL | `https://maleq.com` |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | Base URL for WordPress images (defaults to `https://www.maleq.com`) | `https://www.maleq.com` |
| `WOOCOMMERCE_URL` | WooCommerce REST API base URL | `https://your-wp-site.com` |
| `WOOCOMMERCE_CONSUMER_KEY` | WooCommerce API key | `ck_xxxxx` |
| `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce API secret | `cs_xxxxx` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_live_xxxxx` |
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_xxxxx` |

### Optional Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 ID | `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking DSN | `https://xxx@xxx.ingest.sentry.io/xxx` |
| `REVALIDATION_SECRET` | Secret for cache revalidation webhook (must match `MALEQ_REVALIDATION_SECRET` in wp-config.php) | Random string |
| `ADMIN_API_KEY` | Admin API key for protected endpoints (must match `MALEQ_ADMIN_KEY` in wp-config.php) | Random string |
| `CRON_SECRET` | Secret for automated cron jobs hitting `/api/cron/*` (used by the Coolify scheduled task / external cron; falls back to `ADMIN_API_KEY` for manual triggers) | Random string |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 2.0 Web client ID for "Sign in with Google" (public; used by the GIS button and to verify ID tokens server-side) | `xxxx.apps.googleusercontent.com` |
| `MALEQ_GOOGLE_AUTH_SECRET` | Shared secret protecting the `maleq/v1/google-auth` WP endpoint (must match `MALEQ_GOOGLE_AUTH_SECRET` in wp-config.php) | Random 32+ char string |

### Google Sign-In Setup

1. In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials, create an **OAuth 2.0 Client ID** of type **Web application**.
2. Under **Authorized JavaScript origins**, add every origin the button loads from:
   - `https://www.maleq.com` (production)
   - `http://maleq-local.local` (Local by Flywheel)
   - `http://localhost:3000` (dev)
   (Google Identity Services uses JavaScript origins, not redirect URIs.)
3. Copy the client ID into `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Coolify **build variable** + `.env.local`). Since it is `NEXT_PUBLIC_*` it must be present at build time — set it as a build variable and redeploy, or the button will not render in production.
4. Generate a random secret and set it **identically** in both `MALEQ_GOOGLE_AUTH_SECRET` (Coolify runtime env) and `wp-config.php` (`define('MALEQ_GOOGLE_AUTH_SECRET', '...')`).

> The Google **client secret** is **not** used by this integration — it uses the Google Identity Services (GIS) ID-token flow, which verifies the signed ID token server-side using only the client ID. Only the client ID is needed from Google Cloud Console.

### WordPress wp-config.php Constants

Add to `wp-config.php` on the WordPress server:
```php
define('MALEQ_ADMIN_KEY', 'your-admin-api-key-here');
define('MALEQ_FRONTEND_URL', 'https://your-frontend-domain.com');
define('MALEQ_REVALIDATION_SECRET', 'your-revalidation-secret-here');
define('MALEQ_GOOGLE_AUTH_SECRET', 'your-google-auth-shared-secret-here');
```
- `MALEQ_ADMIN_KEY` must match the `ADMIN_API_KEY` env var in Coolify.
- `MALEQ_FRONTEND_URL` is the production URL of your Next.js site (e.g., `https://maleq.com`).
- `MALEQ_REVALIDATION_SECRET` must match the `REVALIDATION_SECRET` env var in Coolify.
- `MALEQ_GOOGLE_AUTH_SECRET` must match the `MALEQ_GOOGLE_AUTH_SECRET` env var in Coolify.

### Daily Stock Sync (Cron)

A daily job at 6:00 AM UTC syncs stock from STC and Williams Trading:
- **Endpoint**: `/api/cron/stock-sync`
- **Schedule**: `0 6 * * *`
- **Auth**: Uses `CRON_SECRET` (scheduled task) or `ADMIN_API_KEY` (manual trigger)
- **What it does**:
  1. Fetches STC inventory CSV (combined stock) and updates `_stock` for all matched products
  2. Fetches Williams Trading active products and stores `wt_stock_count` meta for fulfillment prioritization

> **Scheduling on Coolify:** there is no `vercel.json` cron in this project. Schedule the job with a **Coolify Scheduled Task** on the application (command: `curl -fsS https://maleq.com/api/cron/stock-sync -H "Authorization: Bearer $CRON_SECRET"`, frequency `0 6 * * *`), or with any external cron (system crontab, GitHub Actions schedule, UptimeRobot heartbeat URL). The endpoint is idempotent and safe to re-run.

**Manual trigger**:
```bash
curl https://maleq.com/api/cron/stock-sync -H "Authorization: Bearer $ADMIN_API_KEY"
```

**Requires**: `maleq-stock-sync.php` mu-plugin installed on WordPress

---

## Deployment Steps

### 1. Connect Repository in Coolify

1. In the Coolify dashboard, create (or open) the application for this project.
2. Source: the connected GitHub repository.
3. Branch: `main`.
4. Build pack: **Nixpacks** (auto-detects the Bun + Next.js project — there is no `Dockerfile` in the repo).

### 2. Configure Build Settings

Coolify/Nixpacks auto-detects Next.js. Verify:

- **Install Command**: `bun install`
- **Build Command**: `bun run build`
- **Start Command**: `bun run start` (Next.js production server)
- **Port**: `3000`

### 3. Add Environment Variables

1. Open the application → **Environment Variables**.
2. Add all required variables from the table above.
3. Mark every `NEXT_PUBLIC_*` variable as a **Build Variable** so it is available during `bun run build` (otherwise it will be empty in the browser).

### 4. Configure Domain & TLS

1. Set the application's domain (e.g., `https://maleq.com`) in Coolify.
2. Point the domain's DNS at the Coolify VPS (`46.224.227.119`).
3. TLS is issued automatically by Coolify's bundled **Traefik** via Let's Encrypt (certs stored in `acme.json`). No manual certificate steps are needed.

### 5. Deploy

1. Push to `main`.
2. Coolify deploys via its GitHub webhook. **Note:** the webhook can be flaky — if a push doesn't trigger a build, open the application in Coolify and click **Deploy** (a manual deploy pulls the current `main` HEAD).
3. Monitor the build logs in Coolify.

> **Build memory caveat:** the Coolify VPS has 8 GB RAM and **no swap**. The Next.js build loads the ~35k-product index per worker, so builds occasionally OOM/get killed transiently. If a build dies with no clear error, just retry the deploy.

---

## Staging Environment

### Setup

1. Create a **separate Coolify application** pointed at the same repo but a staging branch (or `main` with a staging domain).
2. Use separate environment variables:
   - `NEXT_PUBLIC_SITE_URL`: `https://staging.maleq.com`
   - Use Stripe test keys
   - Point to a staging WordPress instance

> Coolify does not provide per-PR preview deployments like Vercel. For pre-merge checks, rely on the GitHub Actions CI (lint/test/build) below, or manually deploy a feature branch to the staging application.

---

## Post-Deployment Checklist

### Immediate Checks

- [ ] Site loads at production URL
- [ ] HTTPS is working (check certificate)
- [ ] Home page renders correctly
- [ ] Product images load
- [ ] Cart functionality works

### Functional Checks

- [ ] User registration works
- [ ] User login works
- [ ] Add to cart works
- [ ] Checkout completes (use Stripe test mode first)
- [ ] Order confirmation displays
- [ ] Email notifications sent

### Cache Revalidation Setup

After your first production deploy, verify the cache revalidation pipeline is working:

1. **Set the env var**: Ensure `REVALIDATION_SECRET` is set in Coolify → application → Environment Variables
2. **Set WordPress constants**: Add `MALEQ_FRONTEND_URL` and `MALEQ_REVALIDATION_SECRET` to production `wp-config.php` (see [WordPress wp-config.php Constants](#wordpress-wp-configphp-constants) above)
3. **Install the mu-plugin**: Copy `maleq-cache-revalidation.php` to production `wp-content/mu-plugins/`
4. **Test revalidation**: Edit and save any product in WooCommerce, then verify the change appears on the frontend within a few seconds
5. **Test manually** (optional):
   ```bash
   curl -X POST https://your-site.com/api/revalidate \
     -H "Content-Type: application/json" \
     -H "x-revalidation-secret: YOUR_SECRET" \
     -d '{"type": "product"}'
   ```
   Should return `{"revalidated": true, ...}`

### Performance Checks

- [ ] Run Lighthouse audit (target >80)
- [ ] Check Core Web Vitals (the app reports Web Vitals via `components/analytics/WebVitals.tsx` → GA4; review in Google Analytics / PageSpeed Insights)
- [ ] Verify caching headers (`Cache-Control: public, s-maxage=300` on `/api/products` responses)

### SEO Checks

- [ ] Sitemap accessible at `/sitemap.xml`
- [ ] Robots.txt accessible at `/robots.txt`
- [ ] Open Graph tags render correctly
- [ ] Submit sitemap to Google Search Console

---

## Monitoring

### Analytics & Web Vitals

There is no Vercel Analytics on Coolify. This project uses:
- **Google Analytics 4** (`NEXT_PUBLIC_GA_ID`) for page views and audience insights (`components/analytics/GoogleAnalytics.tsx`)
- **Web Vitals → GA4** for Core Web Vitals (`components/analytics/WebVitals.tsx`)

### Error Monitoring

1. Configure Sentry DSN in environment variables
2. Monitor errors in Sentry dashboard
3. Set up alerts for critical errors

### Uptime Monitoring

A self-hosted **Uptime Kuma** instance already runs on the WP VPS (port 3001). Use it, or any external monitor (UptimeRobot, Pingdom), to watch the production URL and the `/api/cron/stock-sync` heartbeat.

---

## Rollback Procedure

If issues occur after deployment:

### Using the Coolify Dashboard

1. Open the application → **Deployments**.
2. Find the last known-good deployment.
3. Use **Redeploy** on that commit/build to roll back to it.

### Using Git

```bash
# Revert to previous commit
git revert HEAD
git push origin main
```

---

## CI/CD Pipeline

### GitHub Actions (Optional)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, initial-setup]
  pull_request:
    branches: [main, initial-setup]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      - run: bun install
      - run: bun run lint
      - run: bun run test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      - run: bun install
      - run: bun run build
```

---

## Troubleshooting

### Build Failures

1. Check the build logs in Coolify (application → Deployments → the failed build)
2. Verify all environment variables are set, and that `NEXT_PUBLIC_*` vars are marked as **build variables**
3. Test build locally: `bun run build`
4. If the build was killed with no clear error, suspect a transient OOM (8 GB VPS, no swap, ~35k-product index loaded per worker) — simply retry the deploy
5. If a push didn't trigger a build, the GitHub webhook may have been missed — click **Deploy** manually (pulls current `main` HEAD)

### API Connection Issues

1. Verify WooCommerce URL is accessible
2. Check API credentials are correct
3. Ensure CORS is configured on WordPress

### Payment Issues

1. Verify Stripe keys (test vs live)
2. Check Stripe dashboard for errors
3. Ensure webhook endpoints are configured

### Image Loading Issues

1. Verify image domains in `next.config.ts`
2. Check WordPress media permissions
3. Verify image URLs are accessible

---

## Support

For deployment issues:
- Coolify Documentation: https://coolify.io/docs
- Next.js Documentation: https://nextjs.org/docs
- Project Issues: [GitHub Issues URL]
