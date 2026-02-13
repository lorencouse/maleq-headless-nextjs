# Deployment Guide

This guide covers deploying the Maleq headless e-commerce store to Vercel.

---

## Prerequisites

- Vercel account
- GitHub repository connected to Vercel
- WooCommerce/WordPress backend set up
- Stripe account (production keys for live)
- Domain name configured

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
| `maleq-auth-endpoints.php` | Authentication endpoints for login, password reset, and token validation | `wordpress/mu-plugins/maleq-auth-endpoints.php` |
| `maleq-graphql-title-search.php` | Adds titleSearch parameter to WPGraphQL for searching posts by title only | `wordpress/mu-plugins/maleq-graphql-title-search.php` |
| `maleq-order-tracking.php` | Order tracking management with admin UI, REST API, and customer email notifications | `wordpress/mu-plugins/maleq-order-tracking.php` |
| `maleq-stock-sync.php` | Bulk stock sync endpoints for daily cron (stock-mapping + stock-update) | `wordpress/mu-plugins/maleq-stock-sync.php` |
| `maleq-stock-priority.php` | Orders products with in-stock items first, prioritizes WT/manual over STC sources | `wordpress/mu-plugins/maleq-stock-priority.php` |
| `maleq-graphql-product-source.php` | Exposes `_product_source` meta as `productSource` field in WPGraphQL | `wordpress/mu-plugins/maleq-graphql-product-source.php` |
| `maleq-cache-revalidation.php` | Triggers Next.js cache revalidation on product create/update/delete/stock changes | `wordpress/mu-plugins/maleq-cache-revalidation.php` |
| `maleq-graphql-query-limit.php` | Increases WPGraphQL max query amount to 500 for sitemap generation | `wordpress/mu-plugins/maleq-graphql-query-limit.php` |
| `maleq-cleanup-product-images.php` | Auto-deletes product images (featured, gallery, variation) when product is permanently deleted | `wordpress/mu-plugins/maleq-cleanup-product-images.php` |

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
   ```

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
Either set `NEXT_PUBLIC_IMAGE_BASE_URL=https://www.maleq.com` in Vercel, or omit it (defaults to `https://www.maleq.com`)

---

## Environment Variables

Configure these environment variables in Vercel Dashboard > Project Settings > Environment Variables.

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
| `CRON_SECRET` | Vercel cron secret for automated jobs (set in Vercel dashboard) | Random string |

### WordPress wp-config.php Constants

Add to `wp-config.php` on the WordPress server:
```php
define('MALEQ_ADMIN_KEY', 'your-admin-api-key-here');
define('MALEQ_FRONTEND_URL', 'https://your-frontend-domain.com');
define('MALEQ_REVALIDATION_SECRET', 'your-revalidation-secret-here');
```
- `MALEQ_ADMIN_KEY` must match the `ADMIN_API_KEY` env var in Vercel.
- `MALEQ_FRONTEND_URL` is the production URL of your Next.js site (e.g., `https://maleq.com`).
- `MALEQ_REVALIDATION_SECRET` must match the `REVALIDATION_SECRET` env var in Vercel.

### Daily Stock Sync (Cron)

A Vercel cron job runs daily at 6:00 AM UTC to sync stock from STC and Williams Trading:
- **Endpoint**: `/api/cron/stock-sync`
- **Schedule**: `0 6 * * *` (configured in `vercel.json`)
- **Auth**: Uses `CRON_SECRET` (Vercel cron) or `ADMIN_API_KEY` (manual trigger)
- **What it does**:
  1. Fetches STC inventory CSV (combined stock) and updates `_stock` for all matched products
  2. Fetches Williams Trading active products and stores `wt_stock_count` meta for fulfillment prioritization

**Manual trigger**:
```bash
curl https://your-site.com/api/cron/stock-sync -H "Authorization: Bearer $ADMIN_API_KEY"
```

**Requires**: `maleq-stock-sync.php` mu-plugin installed on WordPress

---

## Deployment Steps

### 1. Connect Repository to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Select the `initial-setup` branch (or `main`)

### 2. Configure Build Settings

Vercel should auto-detect Next.js. Verify these settings:

- **Framework Preset**: Next.js
- **Build Command**: `bun run build`
- **Install Command**: `bun install`
- **Output Directory**: `.next`

### 3. Add Environment Variables

1. Go to Project Settings > Environment Variables
2. Add all required variables from the table above
3. Set appropriate environments (Production, Preview, Development)

### 4. Configure Domain

1. Go to Project Settings > Domains
2. Add your custom domain (e.g., `maleq.com`)
3. Follow DNS configuration instructions
4. SSL is automatic with Vercel

### 5. Deploy

1. Push to the connected branch
2. Vercel automatically deploys
3. Monitor build logs for errors

---

## Staging Environment

### Setup

1. Create a separate Vercel project or use Preview deployments
2. Use separate environment variables:
   - `NEXT_PUBLIC_SITE_URL`: `https://staging.maleq.com`
   - Use Stripe test keys
   - Point to staging WordPress instance

### Preview Deployments

Every PR automatically gets a preview URL. Configure preview-specific variables if needed.

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

1. **Set Vercel env var**: Ensure `REVALIDATION_SECRET` is set in Vercel > Project Settings > Environment Variables
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
- [ ] Check Core Web Vitals in Vercel Analytics
- [ ] Verify caching headers (`Cache-Control: public, s-maxage=300` on `/api/products` responses)

### SEO Checks

- [ ] Sitemap accessible at `/sitemap.xml`
- [ ] Robots.txt accessible at `/robots.txt`
- [ ] Open Graph tags render correctly
- [ ] Submit sitemap to Google Search Console

---

## Monitoring

### Vercel Analytics

Enable Vercel Analytics for:
- Page views
- Core Web Vitals
- Audience insights

### Error Monitoring

1. Configure Sentry DSN in environment variables
2. Monitor errors in Sentry dashboard
3. Set up alerts for critical errors

### Uptime Monitoring

Consider using:
- Vercel's built-in monitoring
- UptimeRobot
- Pingdom

---

## Rollback Procedure

If issues occur after deployment:

### Using Vercel Dashboard

1. Go to Deployments tab
2. Find the last working deployment
3. Click "..." menu > "Promote to Production"

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

1. Check build logs in Vercel
2. Verify all environment variables are set
3. Test build locally: `bun run build`

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
- Vercel Documentation: https://vercel.com/docs
- Next.js Documentation: https://nextjs.org/docs
- Project Issues: [GitHub Issues URL]
