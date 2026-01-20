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

### Installation Steps

1. **Copy plugin files** to WordPress mu-plugins directory:
   ```bash
   # From project root
   cp wordpress-snippets/register-brands-wpgraphql.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-brands.php
   cp wordpress-snippets/register-material-wpgraphql.php /path/to/wordpress/wp-content/mu-plugins/wpgraphql-materials.php
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

### Notes
- mu-plugins load automatically without activation
- These plugins require WPGraphQL and WooGraphQL to be installed
- After deployment, clear any GraphQL/object caches

---

## Environment Variables

Configure these environment variables in Vercel Dashboard > Project Settings > Environment Variables.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_WORDPRESS_API_URL` | WordPress GraphQL endpoint | `https://your-wp-site.com/graphql` |
| `NEXT_PUBLIC_SITE_URL` | Production site URL | `https://maleq.com` |
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
| `REVALIDATION_SECRET` | Secret for on-demand ISR | Random string |

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

### Performance Checks

- [ ] Run Lighthouse audit (target >80)
- [ ] Check Core Web Vitals in Vercel Analytics
- [ ] Verify caching headers

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
