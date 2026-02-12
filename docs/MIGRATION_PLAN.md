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
| Item | Size |
|------|------|
| V1 uploads | 29 GB |
| V2 uploads | 2.8 GB |
| V1 WP core + plugins | ~1 GB |
| V2 WP core + plugins | ~200 MB |
| V1 database | ~500 MB (est.) |
| V2 database | ~500 MB (est.) |
| Server free space | **18 GB** |

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

| Service | Monthly Cost |
|---------|-------------|
| Vercel (Free) | $0 |
| Hetzner CX22 (current) | ~€4 |
| Hetzner Volume 40GB (if Option A) | ~€2 |
| Cloudflare (Free) | $0 |
| **Total** | **€4-6/mo** |

If you outgrow the current server, a Hetzner CX32 (4 vCPU, 8GB RAM, 80GB disk) is ~€8/mo.

---

## Migration Steps

### Phase 0: Pre-Migration Prep (on your Mac)

- [ ] **0.1** Export local V2 database
  ```bash
  # Using Local by Flywheel's MySQL socket
  mysqldump -u root -proot --socket="$HOME/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock" local > ~/v2-database-export.sql
  ```

- [ ] **0.2** Run URL conversion to make DB portable
  ```bash
  bun scripts/convert-urls-to-relative.ts --execute
  ```
  Then re-export the database after conversion.

- [ ] **0.3** Compress V2 uploads for transfer
  ```bash
  cd ~/Local\ Sites/maleq-local/app/public/wp-content/
  tar -czf ~/v2-uploads.tar.gz uploads/
  ```

- [ ] **0.4** Prepare mu-plugins bundle
  ```bash
  cd /Volumes/Mac\ Mini\ M4\ -2TB/MacMini-Data/Documents/web-dev/maleq-headless
  tar -czf ~/v2-mu-plugins.tar.gz wordpress/mu-plugins/ wordpress-snippets/
  ```

- [ ] **0.5** Prepare wp-config.php constants list:
  ```php
  define('MALEQ_ADMIN_KEY', 'generate-random-key');
  define('MALEQ_FRONTEND_URL', 'https://maleq.com');
  define('MALEQ_REVALIDATION_SECRET', 'generate-random-key');
  ```

- [ ] **0.6** Push Next.js code to GitHub (if not already)
  ```bash
  git push origin initial-setup
  ```

### Phase 1: Prepare Hetzner Server

- [ ] **1.1** Upgrade disk (if keeping images on Hetzner)
  - Hetzner Cloud Console > Volumes > Create Volume (40GB, ~€2/mo)
  - Mount at `/mnt/storage` and symlink uploads

- [ ] **1.2** Create V2 WordPress site in CloudPanel
  - New site: `wp.maleq.com` (or `api.maleq.com`)
  - PHP 8.2+ (match your local version)
  - New database: `maleq_v2`
  - CloudPanel will create the vhost and directory structure

- [ ] **1.3** Install Node.js (needed for WP-CLI and optional local tasks only - Next.js runs on Vercel)
  ```bash
  # Not strictly needed if only using Vercel for Next.js
  # But useful for running scripts on server
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  npm install -g bun
  ```

- [ ] **1.4** Install required WP plugins via WP-CLI
  ```bash
  cd /home/[v2-user]/htdocs/wp.maleq.com
  wp --allow-root plugin install woocommerce --activate
  wp --allow-root plugin install wp-graphql --activate
  wp --allow-root plugin install wpgraphql-acf --activate
  # Install WooGraphQL (may need manual upload)
  ```

### Phase 2: Deploy V2 WordPress Backend

- [ ] **2.1** Upload and import V2 database
  ```bash
  # From your Mac
  scp ~/v2-database-export.sql root@159.69.220.162:/tmp/

  # On server
  mysql -u [v2-db-user] -p [v2-db-name] < /tmp/v2-database-export.sql
  ```

- [ ] **2.2** Upload V2 uploads
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

- [ ] **2.4** Update wp-config.php
  - Set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`
  - Set `WP_HOME` and `WP_SITEURL` to `https://wp.maleq.com`
  - Add MALEQ constants (admin key, frontend URL, revalidation secret)
  - Set `DISALLOW_FILE_EDIT` and `DISALLOW_FILE_MODS` (headless = no theme editing)

- [ ] **2.5** Run search-replace for site URL
  ```bash
  wp --allow-root search-replace 'http://maleq-local.local' 'https://wp.maleq.com' --all-tables
  ```

- [ ] **2.6** Configure nginx for V2 (headless optimizations)
  - Disable serving theme frontend (return 404 or redirect)
  - Enable CORS headers for Vercel domain
  - Cache GraphQL responses via Cloudflare
  - Rate-limit wp-login.php and xmlrpc.php

- [ ] **2.7** Set up SSL for wp.maleq.com
  - CloudPanel handles Let's Encrypt automatically
  - Or use Cloudflare origin certificates

- [ ] **2.8** Test WP backend
  - Verify `https://wp.maleq.com/graphql` returns data
  - Verify WooCommerce REST API works
  - Test mu-plugin endpoints

### Phase 3: Pre-Launch Verification (Before Deploying Frontend)

Reference: `docs/LAUNCH_CHECKLIST.md`, `docs/SECURITY_AUDIT.md`, `docs/TODO.md`

#### Security (from Security Audit)
- [ ] **3.0a** Update Next.js to latest stable (currently on 15.5.7, need 15.5.9+)
  ```bash
  bun update next
  ```
- [ ] **3.0b** Verify HSTS and CSP headers are set in `next.config.ts` (CSP added in audit, HSTS added)
- [ ] **3.0c** Generate secure random keys for production:
  ```bash
  # ADMIN_API_KEY, REVALIDATION_SECRET, CRON_SECRET
  openssl rand -hex 32  # run 3 times, one for each
  ```

#### Content & Data (from TODO.md - HIGH priority)
- [ ] **3.0d** Verify all payment flows work (Stripe live mode, order confirmation emails, failed payment handling)
- [ ] **3.0e** Test login/signup flows (email verification, password reset, session persistence)
- [ ] **3.0f** Create `/public/og-image.jpg` (1200x630px) for social sharing
- [ ] **3.0g** Verify product images load correctly from new backend URL
- [ ] **3.0h** Set `ADMIN_API_KEY` env var in production (must match `MALEQ_ADMIN_KEY` in wp-config.php)

### Phase 3: Deploy Next.js Frontend on Vercel

- [ ] **3.1** Create Vercel project
  - Connect GitHub repo
  - Set framework to Next.js
  - Build command: `bun run build`
  - Install command: `bun install`

- [ ] **3.2** Set environment variables in Vercel

  **Required:**
  ```
  NEXT_PUBLIC_WORDPRESS_API_URL=https://wp.maleq.com/graphql
  NEXT_PUBLIC_SITE_URL=https://maleq.com
  NEXT_PUBLIC_IMAGE_BASE_URL=https://wp.maleq.com
  WOOCOMMERCE_URL=https://wp.maleq.com
  WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
  WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
  STRIPE_SECRET_KEY=sk_live_xxxxx
  REVALIDATION_SECRET=<generated-key>
  ADMIN_API_KEY=<generated-key>
  CRON_SECRET=<generated-key>
  ```

  **Optional:**
  ```
  NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
  NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
  ```

- [ ] **3.3** Deploy and test on Vercel preview URL (Critical Path from Launch Checklist)
  - Homepage renders correctly
  - Product pages display with images
  - Search works (MiniSearch fuzzy + "Did you mean?")
  - Navigation and mega menu work
  - Add to cart → View cart → Checkout flow
  - User registration and login
  - Password reset end-to-end
  - Stripe test payment (use test keys first, switch to live at launch)
  - Order confirmation displayed + email received
  - Blog pages render with images
  - Sitemap accessible at `/sitemap.xml`
  - Contact form submissions received

- [ ] **3.4** Cross-browser testing
  - Chrome, Firefox, Safari (Desktop)
  - Chrome, Safari (Mobile/iOS)

- [ ] **3.5** Performance check
  - Run Lighthouse audit (target >80)
  - Verify page load under 3 seconds

- [ ] **3.6** Verify cache revalidation pipeline
  - Edit a product in WP admin → change appears on frontend within seconds
  - See `docs/DEPLOYMENT_GUIDE.md` "Cache Revalidation Setup" section

- [ ] **3.7** Verify daily stock sync cron
  - Manual test: `curl https://preview-url/api/cron/stock-sync -H "Authorization: Bearer $ADMIN_API_KEY"`
  - Confirm `vercel.json` has cron schedule: `0 6 * * *`

### Phase 4: DNS Cutover (The Switch)

This is the critical step. Plan for a maintenance window (low-traffic time).

- [ ] **4.1** Move V1 to old.maleq.com
  - In CloudPanel: change V1 site's domain to `old.maleq.com`
  - Update V1 wp-config.php: `WP_HOME` and `WP_SITEURL` to `https://old.maleq.com`
  - Run: `wp --allow-root search-replace 'https://maleq.com' 'https://old.maleq.com' --all-tables`
  - Update V1 nginx config for `old.maleq.com`

- [ ] **4.2** Update Cloudflare DNS
  ```
  # Remove/update existing records:
  A    maleq.com        → (remove - Vercel will use CNAME)

  # Add new records:
  CNAME  maleq.com      → cname.vercel-dns.com (proxied)
  CNAME  www.maleq.com  → cname.vercel-dns.com (proxied)
  A      wp.maleq.com   → 159.69.220.162 (proxied)
  A      old.maleq.com  → 159.69.220.162 (proxied or DNS-only)
  ```

- [ ] **4.3** Add domain to Vercel
  - Project Settings > Domains > Add `maleq.com` and `www.maleq.com`
  - Vercel will verify DNS and provision SSL

- [ ] **4.4** Verify everything works
  - `https://maleq.com` → Vercel (Next.js V2)
  - `https://wp.maleq.com` → Hetzner (V2 WP backend, GraphQL API)
  - `https://old.maleq.com` → Hetzner (V1 WP, for reference/rollback)

### Phase 5: Post-Launch

#### Immediate (Launch Day)
- [ ] **5.1** Switch Stripe to live keys in Vercel env vars
- [ ] **5.2** Make a small real test purchase to verify end-to-end
- [ ] **5.3** Verify order appears in WooCommerce admin and confirmation email sent

#### SEO & Redirects (First 24 Hours)
- [ ] **5.4** Set up 301 redirects in `next.config.ts`
  - `/product-category/*` → `/sex-toys/*` (already handled in codebase)
  - Map any other V1→V2 URL changes
  - Redirect `old.maleq.com` product URLs to `maleq.com` equivalents (via nginx on Hetzner)
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
- [ ] **5.13** Set up backups
  - V2 database: daily mysqldump cron → store on Hetzner volume or offsite
  ```bash
  # Example cron (add to root crontab)
  0 3 * * * mysqldump -u [user] -p'[pass]' [db] | gzip > /mnt/storage/backups/maleq_v2_$(date +\%Y\%m\%d).sql.gz
  # Keep last 14 days
  0 4 * * * find /mnt/storage/backups/ -name "maleq_v2_*.sql.gz" -mtime +14 -delete
  ```
  - V2 uploads: weekly rsync to backup location
  - Vercel: code is in Git (automatic)

- [ ] **5.14** Set up monitoring
  - UptimeRobot (free) for both `maleq.com` and `wp.maleq.com`
  - Vercel analytics for frontend performance
  - Sentry for error tracking (`NEXT_PUBLIC_SENTRY_DSN` env var)

- [ ] **5.15** Set up WP backend hardening
  - Disable XML-RPC (already blocked in nginx)
  - Install fail2ban or similar for SSH brute force protection
  - Consider Redis object cache for WP (already installed on server)

#### Clean Up (After 2-4 Weeks Stable)
- [ ] **5.16** Decommission old.maleq.com if no longer needed
- [ ] **5.17** Remove V1 files to free 29GB+ of disk space
- [ ] **5.18** Remove unused CloudPanel sites (cloudpanel default, staging)
- [ ] **5.19** Disable unused PHP-FPM pools (7.1-8.0) to free memory

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

| Phase | Description | Duration |
|-------|-------------|----------|
| Phase 0 | Local prep (export, compress, push) | 1-2 hours |
| Phase 1 | Server prep (new site, plugins) | 1-2 hours |
| Phase 2 | Deploy WP backend | 2-3 hours |
| Phase 3 | Pre-launch verification + Vercel deploy | 2-3 hours |
| Phase 4 | DNS cutover | 30 min + propagation |
| Phase 5 | Post-launch monitoring | 48 hours |
| **Total active work** | | **~7-10 hours** |

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| `docs/DEPLOYMENT_GUIDE.md` | Full mu-plugin list, env vars, wp-config constants, cron setup |
| `docs/LAUNCH_CHECKLIST.md` | Detailed launch-day and post-launch verification steps |
| `docs/SECURITY_AUDIT.md` | Security items to address before launch (Next.js update, headers, rate limiting) |
| `docs/TODO.md` | Pre-launch HIGH priority items (payment testing, auth flows, OG image) |
| `docs/UAT_TEST_PLAN.md` | Full user acceptance test plan |
| `docs/API_DOCUMENTATION.md` | API endpoint reference for testing |

## Open Items Not Covered Here (from TODO.md)

These are not migration-blocking but should be addressed around launch:

- [ ] SEO optimize product descriptions (HIGH)
- [ ] Populate product reviews (HIGH)
- [ ] Update shipping tiers (MED)
- [ ] Test contact form spam protection (MED)
- [ ] Replace base64 tokens with proper JWT (MED)
- [ ] Add rate limiting on login/password reset/forms (LOW)
- [ ] Move auth token to httpOnly cookies (LOW)
