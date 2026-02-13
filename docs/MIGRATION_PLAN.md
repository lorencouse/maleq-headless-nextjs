# Migration Plan: Male Q V2 Launch

## Current State

### Hetzner Server (159.69.220.162)

- **OS**: Ubuntu 22.04 LTS, 2 vCPUs, 3.7GB RAM, 38GB disk (19GB used / 18GB free)
- **Panel**: CloudPanel (nginx + PHP-FPM)
- **Stack**: Nginx 1.21.4, PHP 8.4, MySQL 8.0, WP-CLI available
- **No Node.js installed**
- **Existing sites**:
  - V1 live: `/home/maleqcom/htdocs/maleq.com/` (DB: `maleqdb`, prefix: `p1bJcx_`)
  - V1 staging: `/home/maleq-staging/htdocs/staging.maleq.com/`
  - CloudPanel default: `/home/clp/htdocs/app/` (390MB)

### V1 Site (maleq.com - current live)

- WordPress 6.9.1 + WooCommerce
- **29GB uploads** in wp-content/uploads
- Plugins: Yoast SEO Premium, WP Rocket, Wordfence, Stripe, BuddyBoss, etc.
- ~1,000 daily visitors, 5,000 peak

### V2 Local (maleq-headless)

- WordPress backend: ~3GB total (2.8GB uploads)
- Next.js frontend: separate deployment
- 13 custom mu-plugins (WPGraphQL extensions, auth, stock sync, etc.)
- ~31K products in database

### Key Constraint: Disk Space

| Item                 | Size           |
| -------------------- | -------------- |
| V1 uploads           | 29 GB          |
| V2 uploads           | 2.8 GB         |
| V1 WP core + plugins | ~1 GB          |
| V2 WP core + plugins | ~200 MB        |
| V1 database          | ~500 MB (est.) |
| V2 database          | ~500 MB (est.) |
| Server free space    | **18 GB**      |

**Problem**: V1 uploads alone (29GB) exceed free space. We cannot keep both V1 and V2 on the current server without upgrading disk or offloading images.

---

## Recommended Architecture

```
                    Cloudflare DNS
                    ┌──────────┐
                    │ maleq.com│
                    └────┬─────┘
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    ┌──────────┐  ┌───────────┐  ┌──────────────┐
    │  Vercel  │  │  Hetzner  │  │  Cloudflare  │
    │ Next.js  │  │ WP Backend│  │  R2 / Images │
    │ Frontend │  │ (headless)│  │  (optional)  │
    │  FREE    │  │  €4/mo    │  │  FREE tier   │
    └──────────┘  └───────────┘  └──────────────┘
```

### Frontend: **Vercel** (Free Tier)

- **Why**: Purpose-built for Next.js, zero config, automatic deployments
- **Free tier covers**: 100GB bandwidth/mo, serverless functions, edge network
- **1K-5K daily visitors**: Comfortably within free tier
- **Cost**: $0/mo (free tier) or $20/mo (Pro if you hit limits)

### WP Backend: **Hetzner** (same server or upgrade)

- V2 WP runs headless (no frontend traffic, just GraphQL API)
- Headless WP is lightweight: API-only, no page rendering, no theme
- Strip unnecessary V1 plugins (Yoast, WP Rocket, BuddyBoss, Wordfence)

### Images: Two Options

**Option A: Keep on Hetzner (simplest)**

- Serve V2 images from `wp.maleq.com` via nginx
- Put Cloudflare in front for CDN caching (free)
- Requires disk upgrade (~€3/mo for additional volume)

**Option B: Cloudflare R2 (cheapest long-term)**

- Migrate V2 images to R2 (free 10GB storage, free egress)
- 2.8GB well within free tier
- More complex initial setup, but zero image bandwidth costs
- V1 images stay on Hetzner

### DNS: **Cloudflare** (Free)

- Already in use for V1
- Proxy + CDN for WP backend (caches GraphQL responses)
- SSL termination

---

## Cost Summary

| Service                           | Monthly Cost |
| --------------------------------- | ------------ |
| Vercel (Free)                     | $0           |
| Hetzner CX22 (current)            | ~€4          |
| Hetzner Volume 40GB (if Option A) | ~€2          |
| Cloudflare (Free)                 | $0           |
| **Total**                         | **€4-6/mo**  |

If you outgrow the current server, a Hetzner CX32 (4 vCPU, 8GB RAM, 80GB disk) is ~€8/mo.

---

## Migration Steps

### Phase 0: Pre-Migration Prep (on your Mac)

- [x] **0.1** Export local V2 database ✅
- [x] **0.2** Run URL conversion to make DB portable ✅
- [x] **0.3** Compress V2 uploads for transfer ✅
- [x] **0.4** Prepare mu-plugins bundle ✅
- [x] **0.5** Prepare wp-config.php constants list ✅
- [x] **0.6** Push Next.js code to GitHub ✅

### Phase 1: Prepare Hetzner Server

- [x] **1.1** Storage volume mounted at `/mnt/storage`, V1 uploads symlinked ✅
- [x] **1.2** V2 WordPress site created in CloudPanel (`wp.maleq.com`, PHP 8.4, DB: `maleq-wp`) ✅
- [x] **1.3** Node.js not installed (not needed — Next.js runs on Vercel) ✅
- [x] **1.4** WP plugins installed (WooCommerce, WPGraphQL, WooGraphQL) ✅

### Phase 2: Deploy V2 WordPress Backend

- [x] **2.1** V2 database imported ✅

- [x] **2.2** V2 uploads transferred ✅

  ```bash
  # From your Mac
  scp ~/v2-uploads.tar.gz root@159.69.220.162:/tmp/

  # On server
  cd /home/[v2-user]/htdocs/wp.maleq.com/wp-content/
  tar -xzf /tmp/v2-uploads.tar.gz
  chown -R [v2-user]:[v2-user] uploads/
  ```

- [ ] **2.3** Install mu-plugins (all 13 - see `docs/DEPLOYMENT_GUIDE.md` for full list)

  ```bash
  # From your Mac
  scp ~/v2-mu-plugins.tar.gz root@159.69.220.162:/tmp/

  # On server
  cd /tmp && tar -xzf v2-mu-plugins.tar.gz
  MU=/home/[v2-user]/htdocs/wp.maleq.com/wp-content/mu-plugins

  # wordpress-snippets → mu-plugins (renamed)
  cp wordpress-snippets/register-brands-wpgraphql.php $MU/wpgraphql-brands.php
  cp wordpress-snippets/register-material-wpgraphql.php $MU/wpgraphql-materials.php
  cp wordpress-snippets/wpgraphql-increase-limit.php $MU/wpgraphql-increase-limit.php
  cp wordpress-snippets/wpgraphql-render-blocks.php $MU/wpgraphql-render-blocks.php
  cp wordpress-snippets/relative-urls.php $MU/maleq-relative-urls.php

  # wordpress/mu-plugins → mu-plugins (direct copy)
  cp wordpress/mu-plugins/wholesale-price-display.php $MU/
  cp wordpress/mu-plugins/maleq-auth-endpoints.php $MU/
  cp wordpress/mu-plugins/maleq-graphql-title-search.php $MU/
  cp wordpress/mu-plugins/maleq-order-tracking.php $MU/
  cp wordpress/mu-plugins/maleq-stock-sync.php $MU/
  cp wordpress/mu-plugins/maleq-stock-priority.php $MU/
  cp wordpress/mu-plugins/maleq-graphql-product-source.php $MU/
  cp wordpress/mu-plugins/maleq-cache-revalidation.php $MU/

  chown -R [v2-user]:[v2-user] $MU/
  ```

- [ ] **2.3b** Run material migration (one-time, if not already in DB export)

  ```bash
  # Option A: SQL (recommended for 31K products)
  mysql -u [v2-db-user] -p [v2-db-name] < /tmp/wordpress-snippets/migrate-materials.sql
  ```

- [x] **2.4** wp-config.php configured (DB creds, WP_HOME/SITEURL, MALEQ constants) ✅
- [x] **2.5** Search-replace completed (`maleq-local.local` → `wp.maleq.com`) ✅
- [x] **2.6** Nginx configured for V2 (CORS, xmlrpc blocked) ✅
- [x] **2.7** SSL for wp.maleq.com (DNS-only, Let's Encrypt via CloudPanel) ✅
- [x] **2.8** WP backend verified — GraphQL returns data at `https://wp.maleq.com/graphql` ✅

### Phase 3: Pre-Launch Verification (Before Deploying Frontend)

Reference: `docs/LAUNCH_CHECKLIST.md`, `docs/SECURITY_AUDIT.md`, `docs/TODO.md`

#### Security (from Security Audit)

- [x] **3.0a** Update Next.js to latest stable (15.5.9) ✅
- [x] **3.0b** Verify HSTS and CSP headers are set in `next.config.ts` and `vercel.json` ✅
- [x] **3.0c** Production keys set in Vercel (ADMIN_API_KEY, REVALIDATION_SECRET, CRON_SECRET) ✅

#### Content & Data (from TODO.md - HIGH priority)

- [ ] **3.0d** Verify all payment flows work (Stripe live mode, order confirmation emails, failed payment handling)
- [ ] **3.0e** Test login/signup flows (email verification, password reset, session persistence)
- [x] **3.0f** Created `/public/og-image.jpg` (1200x630px) for social sharing ✅
- [x] **3.0g** Product images load correctly from wp.maleq.com ✅
- [x] **3.0h** `ADMIN_API_KEY` env var set in Vercel production ✅

### Phase 3: Deploy Next.js Frontend on Vercel

- [x] **3.1** Vercel project created (connected to GitHub, bun build/install) ✅

- [x] **3.2** All environment variables set in Vercel ✅

- [x] **3.3** Deploy and test on Vercel preview URL ✅
  - [x] Homepage renders correctly
  - [x] Product pages display with images
  - [x] Search works (MiniSearch fuzzy + "Did you mean?")
  - [x] Navigation and mega menu work
  - [ ] Add to cart → View cart → Checkout flow (manual test needed)
  - [ ] User registration and login (manual test needed)
  - [ ] Password reset end-to-end (manual test needed)
  - [ ] Stripe test payment (currently test keys — switch to live at launch)
  - [ ] Order confirmation displayed + email received (manual test needed)
  - [x] Blog pages render with images
  - [x] Sitemap accessible at `/sitemap.xml`
  - [ ] Contact form submissions received (manual test needed)

- [ ] **3.4** Cross-browser testing (manual)
  - Chrome, Firefox, Safari (Desktop)
  - Chrome, Safari (Mobile/iOS)

- [x] **3.5** Performance check ✅
  - Lighthouse: Homepage 92 perf / 96 a11y / 96 best practices
  - Product page: 97 performance
  - Fixed duplicate page titles (SEO improvement)

- [x] **3.6** Cache revalidation pipeline verified ✅
  - Tested with WP revalidation secret — returns `{"revalidated":true}`

- [x] **3.7** Stock sync cron configured ✅
  - `vercel.json` has cron schedule: `0 6 * * *`
  - Endpoint authenticates correctly
  - **Note**: Times out on Vercel Hobby tier (60s limit) with 30K+ products
  - Consider: Vercel Pro (300s) or server-side cron for full sync

### Phase 4: DNS Cutover (The Switch)

This is the critical step. Plan for a maintenance window (low-traffic time).

- [x] **4.1** V1 moved to old.maleq.com ✅
  - Nginx config updated to `old.maleq.com`
  - V1 wp-config.php updated: `WP_HOME` and `WP_SITEURL` to `https://old.maleq.com`
  - Search-replace running on V1 database (large DB)

- [x] **4.2** Cloudflare DNS updated ✅

  ```
  # Remove/update existing records:
  A    maleq.com        → (remove - Vercel will use CNAME)

  # Add new records:
  CNAME  maleq.com      → cname.vercel-dns.com (proxied)
  CNAME  www.maleq.com  → cname.vercel-dns.com (proxied)
  A      wp.maleq.com   → 159.69.220.162 (proxied)
  A      old.maleq.com  → 159.69.220.162 (proxied or DNS-only)
  ```

- [x] **4.3** Domains added to Vercel (`maleq.com` + `www.maleq.com`) ✅

- [x] **4.4** Verified all domains working ✅
  - `https://maleq.com` → Vercel (Next.js V2, 200 OK, cache HIT)
  - `https://www.maleq.com` → 308 redirect to maleq.com
  - `https://wp.maleq.com` → Hetzner (GraphQL API responding)
  - `https://old.maleq.com` → Hetzner (V1 WP rollback — search-replace in progress)

### Phase 5: Post-Launch

#### Immediate (Launch Day)

- [ ] **5.1** Switch Stripe to live keys in Vercel env vars
- [ ] **5.2** Make a small real test purchase to verify end-to-end
- [ ] **5.3** Verify order appears in WooCommerce admin and confirmation email sent

#### SEO & Redirects (First 24 Hours)

- [x] **5.4** 301 redirects configured ✅
  - `next.config.ts`: `/product-category/*`→`/sex-toys/*`, `/my-account`→`/account`, `/returns`→`/shipping-returns`, `/category/*`→`/guides/category/*`, `/tag/*`→`/guides/tag/*`
  - `old.maleq.com` nginx: product/category/account URLs redirect to maleq.com equivalents
- [ ] **5.5** Submit new sitemap to Google Search Console
  ```
  https://maleq.com/sitemap.xml
  ```
- [ ] **5.6** Verify Open Graph tags render correctly (use Facebook Sharing Debugger)
- [ ] **5.7** Verify structured data (use Google Rich Results Test)
  - Product, Organization, WebSite, BlogPosting, BreadcrumbList schemas

#### Monitoring (First 48 Hours)

- [ ] **5.8** Monitor Vercel function logs for errors
- [ ] **5.9** Monitor WP backend health (memory, CPU via CloudPanel)
- [ ] **5.10** Watch Google Search Console for crawl errors
- [ ] **5.11** Check conversion tracking in Google Analytics
- [ ] **5.12** Monitor first real orders processing correctly

#### Infrastructure Setup (First Week)

- [x] **5.13** Database backups configured ✅
  - Weekly cron (Sunday 3 AM): `/usr/local/bin/maleq-backup.sh`
  - Compressed dumps stored at `/mnt/storage/backups/` (~38MB each)
  - Auto-cleanup: backups older than 14 days deleted
  - Vercel: code is in Git (automatic)

- [x] **5.14** Server-side health monitoring configured ✅
  - Cron every 5 min: `/usr/local/bin/maleq-healthcheck.sh`
  - Checks: maleq.com (frontend), wp.maleq.com/graphql, wp-login.php
  - Alerts logged to `/var/log/maleq-healthcheck.log`
  - Optional: Add UptimeRobot for external monitoring + email alerts

- [x] **5.15** WP backend hardened ✅
  - XML-RPC blocked in nginx
  - fail2ban installed: SSH (3 attempts/2hr ban), nginx-http-auth, wordpress-login jails
  - Already caught 5 SSH brute-force IPs on first run
  - Nginx config backup files cleaned up

#### Clean Up (After 2-4 Weeks Stable)

- [ ] **5.16** Decommission old.maleq.com if no longer needed
- [ ] **5.17** Remove V1 files to free 29GB+ of disk space
- [ ] **5.18** Remove unused CloudPanel sites (cloudpanel default)
- [x] **5.19** Disabled unused PHP-FPM pools (8.0, 8.1, 8.2) ✅ — only 8.3 (V1) and 8.4 (V2) remain
- [x] **5.20** Staging site removed (nginx, PHP pool, Cloudflare DNS) ✅

---

## Rollback Plan

If V2 has critical issues after launch:

1. **Quick rollback (5 min)**: Revert Cloudflare DNS for `maleq.com` back to Hetzner IP
2. **Restore V1 nginx config** to serve maleq.com from the V1 directory
3. **Revert V1 wp-config.php** site URLs back to `maleq.com`

This is why we keep V1 as `old.maleq.com` rather than deleting it immediately.

---

## Server Resource Considerations

The current CX22 (2 vCPU, 4GB RAM) should handle V2 WP backend fine since:

- No frontend rendering (headless = just API responses)
- Next.js/Vercel handles all visitor traffic
- WP only serves GraphQL queries from Vercel's serverless functions
- MySQL handles the product database (~31K products)

**Watch for**: Memory pressure if MySQL + PHP-FPM + all those PHP-FPM pools eat RAM. Consider disabling unused PHP versions (7.1-8.0) to free memory:

```bash
systemctl disable --now php7.1-fpm php7.2-fpm php7.3-fpm php7.4-fpm php8.0-fpm
```

---

## Timeline Estimate

| Phase                 | Description                             | Duration             |
| --------------------- | --------------------------------------- | -------------------- |
| Phase 0               | Local prep (export, compress, push)     | 1-2 hours            |
| Phase 1               | Server prep (new site, plugins)         | 1-2 hours            |
| Phase 2               | Deploy WP backend                       | 2-3 hours            |
| Phase 3               | Pre-launch verification + Vercel deploy | 2-3 hours            |
| Phase 4               | DNS cutover                             | 30 min + propagation |
| Phase 5               | Post-launch monitoring                  | 48 hours             |
| **Total active work** |                                         | **~7-10 hours**      |

---

## Related Documentation

| Document                    | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `docs/DEPLOYMENT_GUIDE.md`  | Full mu-plugin list, env vars, wp-config constants, cron setup                   |
| `docs/LAUNCH_CHECKLIST.md`  | Detailed launch-day and post-launch verification steps                           |
| `docs/SECURITY_AUDIT.md`    | Security items to address before launch (Next.js update, headers, rate limiting) |
| `docs/TODO.md`              | Pre-launch HIGH priority items (payment testing, auth flows, OG image)           |
| `docs/UAT_TEST_PLAN.md`     | Full user acceptance test plan                                                   |
| `docs/API_DOCUMENTATION.md` | API endpoint reference for testing                                               |

## Open Items Not Covered Here (from TODO.md)

These are not migration-blocking but should be addressed around launch:

- [ ] SEO optimize product descriptions (HIGH)
- [ ] Populate product reviews (HIGH)
- [ ] Update shipping tiers (MED)
- [ ] Test contact form spam protection (MED)
- [ ] Replace base64 tokens with proper JWT (MED)
- [ ] Add rate limiting on login/password reset/forms (LOW)
- [ ] Move auth token to httpOnly cookies (LOW)
