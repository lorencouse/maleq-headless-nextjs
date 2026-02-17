# Male Q Headless — Project Architecture

> Last updated: 2026-02-17

---

## System Overview

Male Q is a headless e-commerce platform built with **Next.js 16** on the frontend and **WordPress + WooCommerce** as the backend CMS/commerce engine. The frontend communicates with WordPress via **direct MySQL** for product listing/filtering (in-memory index) and **WPGraphQL** for blog content and as a fallback. The frontend is deployed as a Docker container on a **Coolify** self-hosted PaaS, while WordPress runs on a separate **Hetzner VPS** managed by **CloudPanel**.

```
┌─────────────────────┐         GraphQL / REST          ┌─────────────────────────┐
│   Coolify Server    │◄───────────────────────────────►│   WordPress Server      │
│   (Next.js App)     │                                 │   (WP + WooCommerce)    │
│                     │         Revalidation webhook     │                         │
│   46.224.227.119    │◄────────────────────────────────│   159.69.220.162        │
│   Traefik reverse   │                                 │   Nginx (CloudPanel)    │
│   proxy → :3000     │         MySQL :3306 (firewall)  │   MySQL 8.0             │
└─────────────────────┘◄───────────────────────────────►└─────────────────────────┘
         │                                                         │
         │  HTTPS (maleq.com)                                      │  HTTPS (wp.maleq.com)
         ▼                                                         ▼
    End Users                                               WP Admin Panel
```

---

## Infrastructure

### Server 1 — WordPress / WooCommerce (Hetzner)

| Spec | Value |
|------|-------|
| **Host** | `ssh root@159.69.220.162` (alias: `ssh hetzner`) |
| **OS** | Ubuntu 22.04.5 LTS (Jammy) |
| **Arch** | aarch64 (ARM64) |
| **CPU** | 2 vCPUs |
| **RAM** | 3.7 GB (+ 2 GB swap) |
| **Disk** | 38 GB root (`/dev/sdb1`, 76% used) + 130 GB storage volume (`/dev/sda` → `/mnt/storage`, 38% used) |
| **Panel** | CloudPanel |
| **Web Server** | Nginx 1.21.4 (CloudPanel-managed `clp-nginx`) |
| **PHP** | 8.4.8 (php-fpm) + CloudPanel PHP 8.1 (clp-php-fpm) |
| **Database** | MySQL 8.0.45 |
| **Caching** | Redis Server + Memcached |
| **Docker** | Running Uptime Kuma on port 3001 |
| **Domain** | `wp.maleq.com` (API/admin), `www.maleq.com` (legacy images) |

**WordPress Installation:**
- **Path:** `/home/maleq-wp/htdocs/wp.maleq.com/`
- **Version:** 6.9.1
- **Legacy V1 site:** `/mnt/storage/wordpress-sites/maleq.com/` (on storage volume)

**Running Services:**
| Service | Purpose |
|---------|---------|
| `clp-nginx` + `nginx` | CloudPanel reverse proxy + vhosts |
| `clp-php-fpm` | CloudPanel PHP 8.1 FPM |
| `php8.4-fpm` | PHP 8.4 FPM for WordPress |
| `mysql` | MySQL 8.0 database |
| `redis-server` | Object cache (wp-redis plugin) |
| `memcached` | Additional caching layer |
| `docker` | Uptime Kuma monitoring |

**Nginx Virtual Hosts:**
- `wp.maleq.com.conf` — headless WordPress API
- `www.maleq.com.conf` — legacy site / image serving
- `old.maleq.com.conf` — old site reference
- `custom-domain.conf` — additional domain
- `default.conf` — CloudPanel default

**Firewall (UFW):**
| Port | Access |
|------|--------|
| 22/tcp | Anywhere (SSH) |
| 80/tcp | Anywhere (HTTP) |
| 443 | Anywhere (HTTPS) |
| 3001/tcp | Anywhere (Uptime Kuma) |
| 3306 | 46.224.227.119 only (MySQL from Coolify) |
| 8433-8443/tcp | Anywhere (CloudPanel admin) |

**Cron Jobs:**
| Schedule | Command | Purpose |
|----------|---------|---------|
| `0 3 * * *` | `maleq-backup.sh` | Daily backup at 3 AM |
| `*/5 * * * *` | `maleq-healthcheck.sh` | Health check every 5 min |
| `*/5 * * * *` | `curl wp.maleq.com/wp-cron.php` | WP-Cron trigger every 5 min |

---

### Server 2 — Coolify / Next.js Frontend

| Spec | Value |
|------|-------|
| **Host** | `ssh deploy@46.224.227.119` |
| **OS** | Ubuntu 24.04.4 LTS (Noble) |
| **Arch** | aarch64 (ARM64) |
| **CPU** | 4 vCPUs |
| **RAM** | 7.5 GB (no swap) |
| **Disk** | 76 GB (`/dev/sda1`, 29% used) |
| **Platform** | Coolify 4.0.0-beta.463 |
| **Proxy** | Traefik v3.6 (ports 80, 443, 8080) |
| **Domain** | `maleq.com` / `www.maleq.com` (frontend) |

**Docker Containers:**
| Container | Image | Status | Resources |
|-----------|-------|--------|-----------|
| Next.js App | `v88k8w4...:6d40addd` | Up | ~1.25 GB RAM |
| `coolify-proxy` | `traefik:v3.6` | Up (healthy) | ~142 MB RAM |
| `coolify` | `coolify:4.0.0-beta.463` | Up (healthy) | ~344 MB RAM |
| `coolify-db` | `postgres:15-alpine` | Up (healthy) | ~53 MB RAM |
| `coolify-realtime` | `coolify-realtime:1.0.10` | Up (healthy) | ~105 MB RAM |
| `coolify-redis` | `redis:7-alpine` | Up (healthy) | ~19 MB RAM |
| `coolify-sentinel` | `sentinel:0.0.18` | Up (healthy) | ~15 MB RAM |

**Total RAM usage:** ~1.9 GB / 7.5 GB (~25%)

**Docker Networks:**
- `coolify` — bridge network for all Coolify services
- `bridge` — default Docker bridge
- `host` / `none` — standard Docker networks

**Deployment Flow:**
1. Push to `main` branch on GitHub
2. Coolify detects push, builds Docker image from `Dockerfile`
3. Multi-stage build: Bun deps → Node.js build → Alpine production image
4. Traefik routes `maleq.com` → container port 3000
5. Container image tagged with git commit SHA (e.g., `6d40addd`)

---

## Application Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16.1.6 (App Router, Turbopack) |
| **Runtime** | Node.js 20 (production), Bun (development/deps) |
| **Language** | TypeScript 5 (strict mode) |
| **Styling** | Tailwind CSS 4.0 |
| **State** | Zustand 5 (cart, auth, checkout, wishlist, UI) |
| **Data Fetching** | React Query 5 + graphql-request + mysql2 (direct DB) |
| **Product Index** | In-memory product index (~35K entries, ~15-20 MB) loaded from MySQL |
| **Forms** | React Hook Form + Zod validation |
| **Payments** | Stripe (Payment Intents, Express Checkout) |
| **Search** | MiniSearch (fuzzy matching, spell correction) |
| **Analytics** | Google Analytics 4, Sentry error tracking |
| **Email** | Nodemailer (SMTP via iCloud) |
| **Image Processing** | Sharp, Next.js Image (AVIF/WebP) |
| **Testing** | Jest + React Testing Library, Playwright E2E |

### Frontend Directory Structure

```
maleq-headless/
├── app/                    # Next.js App Router
│   ├── (pages)             # ~30 page routes
│   ├── api/                # ~35 API routes
│   ├── layout.tsx          # Root layout
│   ├── robots.ts           # Robots.txt
│   └── sitemap.ts          # Dynamic sitemap
├── components/             # ~20 component directories
│   ├── product/            # ProductCard, Gallery, Variations, QuickView
│   ├── checkout/           # CheckoutForm, Payment, Stripe, Express
│   ├── shop/               # ProductGrid, Filters, Sort
│   ├── blog/               # BlogPostCard, BlogContent, Search
│   ├── layout/             # Header, Footer, Breadcrumbs
│   ├── navigation/         # MainNav, MobileMenu, SearchBar
│   ├── auth/               # Login, Register, PasswordReset
│   ├── cart/               # CartTable, CartSummary
│   ├── account/            # AccountNav, OrderHistory, Details
│   ├── reviews/            # ReviewList, ReviewForm
│   ├── ui/                 # LoadingSpinner, Skeleton, Quantity
│   └── ...                 # seo, analytics, wishlist, etc.
├── lib/                    # Business logic & services
│   ├── db/                 # Direct MySQL access layer
│   │   ├── pool.ts         # Connection pool singleton (mysql2/promise)
│   │   ├── index-loader.ts # Loads lightweight product data for in-memory index
│   │   ├── product-queries.ts # Full product fetch by slug (detail pages)
│   │   └── category-loader.ts # Hierarchical categories from MySQL
│   ├── products/           # Product service (MySQL index → GraphQL fallback)
│   │   ├── combined-service.ts # Unified product API (index + GraphQL)
│   │   ├── product-index.ts    # In-memory index singleton + query API
│   │   └── index-to-unified.ts # Index entry → UnifiedProduct mapper
│   ├── blog/               # Blog service
│   ├── store/              # Zustand stores (cart, auth, checkout, wishlist, UI)
│   ├── queries/            # GraphQL query definitions
│   ├── search/             # MiniSearch index & spell correction
│   ├── stripe/             # Stripe client + server
│   ├── woocommerce/        # WooCommerce REST client
│   ├── import/             # Product import pipeline
│   ├── api/                # Admin auth, rate limiting, validation
│   ├── hooks/              # React hooks (useSearch, useAddToCart)
│   ├── utils/              # Shared utilities (incl. php-unserialize.ts)
│   ├── validations/        # Zod schemas
│   └── config/             # Navigation, category icons, addons
├── scripts/                # CLI tools (import, sync, cleanup)
├── wordpress/mu-plugins/   # WordPress must-use plugins (source)
├── docs/                   # Documentation
├── __tests__/              # Jest unit tests
├── e2e/                    # Playwright E2E tests
└── public/                 # Static assets
```

### Page Routes

| Route | Type | Description |
|-------|------|-------------|
| `/` | SSG | Homepage with hero, featured, categories |
| `/shop` | ISR | Product listing with filters |
| `/product/[slug]` | ISR | Product detail page |
| `/sex-toys/[slug]` | ISR | Category pages |
| `/brand/[slug]` | ISR | Brand pages |
| `/brands` | ISR | All brands listing |
| `/search` | Dynamic | Search results |
| `/guides` | ISR | Blog listing |
| `/guides/[slug]` | ISR | Blog post |
| `/guides/category/[slug]` | ISR | Blog category |
| `/cart` | Dynamic | Shopping cart |
| `/checkout` | Dynamic | Checkout flow (Stripe) |
| `/account/*` | Dynamic | User account (orders, details, addresses, wishlist) |
| `/login`, `/register` | Dynamic | Authentication |
| `/contact`, `/about`, `/faq` | SSG | Static info pages |
| `/order-confirmation/[id]` | Dynamic | Post-purchase confirmation |
| `/track-order` | Dynamic | Order tracking |
| `/admin/sync` | Dynamic | Admin sync dashboard |

### API Routes

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/api/auth/*` | Public | Login, register, logout, password reset |
| `/api/search` | Public | Product search |
| `/api/blog/search` | Public | Blog search |
| `/api/products` | Public | Product listing |
| `/api/products/track-view` | Public | Track product views |
| `/api/reviews` | Public | Product reviews |
| `/api/comments` | Public | Blog comments |
| `/api/contact` | Public | Contact form |
| `/api/newsletter/subscribe` | Public | Newsletter signup |
| `/api/stock-alerts/subscribe` | Public | Stock alerts |
| `/api/orders/create` | Auth | Create order |
| `/api/payment/create-intent` | Auth | Stripe payment intent |
| `/api/stripe/webhook` | Stripe sig | Stripe webhook |
| `/api/coupons/validate` | Auth | Coupon validation |
| `/api/customers/[id]` | Auth | Customer data |
| `/api/admin/sync/*` | Admin key | Product/category/stock sync |
| `/api/admin/warm-cache` | Admin key | Cache pre-warming |
| `/api/revalidate` | Secret | On-demand ISR revalidation |
| `/api/cron/stock-sync` | Cron secret | Daily stock sync |

---

## WordPress Backend

### Active Plugins

| Plugin | Version | Purpose |
|--------|---------|---------|
| **WooCommerce** | 10.5.1 | E-commerce engine |
| **WPGraphQL** | 2.9.0 | GraphQL API for WordPress |
| **WPGraphQL WooCommerce** | 0.21.2 | WooCommerce fields in GraphQL |
| **Redis Object Cache** | 2.7.0 | Persistent object cache |

### Custom MU-Plugins (20 plugins)

**GraphQL Extensions:**
| Plugin | Purpose |
|--------|---------|
| `wpgraphql-brands.php` | Expose Brands taxonomy in GraphQL |
| `wpgraphql-materials.php` | Expose Materials taxonomy in GraphQL |
| `wpgraphql-increase-limit.php` | Increase query limit to 500 |
| `wpgraphql-render-blocks.php` | Render Gutenberg blocks in content |
| `maleq-graphql-title-search.php` | Title-only search parameter |
| `maleq-graphql-product-source.php` | Expose `_product_source` meta |
| `maleq-graphql-query-limit.php` | Query limit for sitemaps |
| `maleq-product-views.php` | Track + expose view counts |

**E-commerce Logic:**
| Plugin | Purpose |
|--------|---------|
| `maleq-stock-sync.php` | Bulk stock sync REST endpoints |
| `maleq-stock-priority.php` | In-stock priority, WT > STC ordering |
| `maleq-order-tracking.php` | Tracking management, admin UI, email notifications |
| `wholesale-price-display.php` | Wholesale price in admin panels |
| `maleq-cleanup-product-images.php` | Auto-delete images on product removal |

**Authentication & Security:**
| Plugin | Purpose |
|--------|---------|
| `maleq-auth-endpoints.php` | Login, token validation, password reset REST API |
| `maleq-cache-revalidation.php` | Webhook to trigger Next.js ISR revalidation |

**Infrastructure:**
| Plugin | Purpose |
|--------|---------|
| `maleq-relative-urls.php` | Convert absolute URLs to relative |
| `maleq-smtp.php` | SMTP email configuration |
| `maleq-email-customizer.php` | Branded WooCommerce emails |
| `block-frontend.php` | Block frontend access (headless mode) |

---

## Data Flow

### Product Data Source Resolution

The system uses a tiered data source strategy controlled by the `DATA_SOURCE` env var:

```
Request for product data
  → Check DATA_SOURCE env var
  → If 'graphql': skip MySQL, use GraphQL only
  → If 'auto' (default): try MySQL index → fallback to GraphQL
  → isMySQLConfigured() checks for MYSQL_HOST/DB/USER/PASS env vars
```

### In-Memory Product Index

```
Server startup (lazy, on first request)
  → loadProductIndex() runs 2 SQL queries against WordPress MySQL:
    1. Products + wp_wc_product_meta_lookup + thumbnails + view counts
    2. Taxonomy relationships (categories, brands, materials, colors, product_type)
  → Builds ~35K ProductIndexEntry objects (~15-20 MB in memory)
  → Pre-builds lookup Maps: bySlug, byCategorySlug, byBrandSlug
  → Auto-refreshes every 5 minutes via setInterval(.unref())
  → Revalidation webhook triggers immediate invalidation
```

**Pages using the index:**
| Page | Index Usage |
|------|------------|
| `/` (homepage) | Featured products, trending/sale products |
| `/shop` | All product listing, filtering, faceted search |
| `/sex-toys/[slug]` | Category products, sale products, filter facets |
| `/api/products` | Product API endpoint |
| `/product/[slug]` | Falls back to direct MySQL query (full product data) |

### Product Listing (Read Path — Index)
```
User visits /shop or /sex-toys/[slug]
  → Next.js checks ISR cache
  → Cache miss: queryProductIndex() filters in-memory (~1-5ms)
  → Returns products + facet counts (brands, materials, colors)
  → Categories loaded from MySQL via loadHierarchicalCategories()
  → If index unavailable: falls through to GraphQL
```

### Single Product Display (Read Path)
```
User visits /product/[slug]
  → Next.js checks ISR cache
  → Cache miss: tries getProductBySlugFromDB() (direct MySQL)
  → Fetches product, meta, taxonomies, variations, reviews in parallel
  → If MySQL unavailable: falls through to GraphQL query
  → Images served from wp.maleq.com via Next.js Image optimization
```

### Product Update (Write Path)
```
Admin edits product in WP Admin
  → WooCommerce saves to MySQL
  → maleq-cache-revalidation.php fires webhook
  → POST /api/revalidate on Coolify (Next.js)
  → Next.js invalidates ISR cache for affected pages
  → invalidateProductIndex() triggers index reload on next request
  → invalidateCategoryCache() clears category tree cache
  → Next request triggers fresh render with updated data
```

### Checkout Flow
```
User adds to cart (Zustand store, client-side)
  → /checkout page loads Stripe Elements
  → POST /api/payment/create-intent → Stripe API
  → User completes payment via Stripe
  → Stripe webhook → POST /api/stripe/webhook
  → Next.js creates WooCommerce order via REST API
  → Redirect to /order-confirmation/[orderId]
```

### Stock Sync
```
Cron trigger → POST /api/cron/stock-sync
  → Next.js calls WP REST: /wp-json/maleq/v1/stock-mapping
  → Fetches current stock from Williams Trading API
  → Compares with WooCommerce stock levels
  → Bulk updates via /wp-json/maleq/v1/stock-update
  → Changed products trigger ISR revalidation
```

---

## Security

### Network Security
- UFW firewall on both servers
- MySQL port (3306) restricted to Coolify IP only
- fail2ban active on WordPress server
- SSH key-only authentication

### Application Security
- **CSP Headers:** Script/style/img sources whitelisted; `unsafe-eval` dev-only
- **HSTS:** Strict transport security enabled
- **Rate Limiting:** Per-route limits on API endpoints (auth, forms, orders)
- **Admin Auth:** `ADMIN_API_KEY` required for sync/admin endpoints
- **Revalidation Auth:** `REVALIDATION_SECRET` for ISR webhooks
- **WP Auth:** `maleq_authenticate_request()` helper for REST endpoints
- **XSS Prevention:** sanitize-html for all user-generated HTML
- **SEO Isolation:** Cart/checkout/account pages have `robots: { index: false }`
- **Payments:** Stripe webhook signature verification

### Monitoring
- Uptime Kuma (port 3001 on WordPress server) — uptime monitoring
- Sentry — frontend error tracking
- Google Analytics 4 — user analytics
- Health check script every 5 minutes

---

## Environment Variables

### Next.js (Coolify)
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_WORDPRESS_API_URL` | WPGraphQL endpoint (`https://wp.maleq.com/graphql`) |
| `NEXT_PUBLIC_SITE_URL` | Frontend URL (`https://maleq.com`) |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | Image CDN base URL |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe public key |
| `STRIPE_SECRET_KEY` | Stripe server key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 ID |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking |
| `WOOCOMMERCE_CONSUMER_KEY` | WooCommerce REST API key |
| `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce REST API secret |
| `ADMIN_API_KEY` | Admin endpoint authentication |
| `REVALIDATION_SECRET` | ISR revalidation webhook secret |
| `CRON_SECRET` | Cron job authentication |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | Email sending (iCloud SMTP) |
| `MYSQL_HOST` | WordPress MySQL host (`159.69.220.162` in production) |
| `MYSQL_PORT` | MySQL port (`3306` in production, `3307` via SSH tunnel for local dev) |
| `MYSQL_DB` | WordPress database name (`maleq-wp`) |
| `MYSQL_USER` | MySQL user (`maleq-wp`) |
| `MYSQL_PASS` | MySQL password |
| `DATA_SOURCE` | Data source strategy: `auto` (MySQL → GraphQL), `graphql` (GraphQL only) |

### WordPress (wp-config.php)
| Constant | Purpose |
|----------|---------|
| `MALEQ_REVALIDATION_SECRET` | Must match `REVALIDATION_SECRET` above |
| `MALEQ_ADMIN_KEY` | Must match `ADMIN_API_KEY` above |
| `MALEQ_FRONTEND_URL` | Next.js frontend URL for webhooks |

---

## Product Data

- **~31,000** unique simple products
- **~11,000** have brand taxonomy
- **~10,000** have manufacturer codes
- **~2,800** potential variation groups (~6,400 products)
- **Sources:** Williams Trading (primary, `_wt_*` meta), STC imports
- Images stored in WordPress media library, served via `wp.maleq.com`

---

## Development Setup

### Local Environment
- **Package Manager:** Bun
- **Dev Server:** `bun dev` (Next.js with Turbopack)
- **Local WordPress:** Local by Flywheel at `~/Local Sites/maleq-local/`
- **Local DB:** MySQL via Local socket
- **Remote DB (SSH tunnel):** `ssh -f -N -L 3307:127.0.0.1:3306 hetzner` → set `MYSQL_PORT=3307`
- **Type Checking:** `npx tsc --noEmit --skipLibCheck`

### Key Constraints
- **Never run `bun run build` locally** — can crash/hang
- **Never use `isomorphic-dompurify`** — breaks Vercel/webpack (use `sanitize-html`)
- **Prefer WPGraphQL over WooCommerce REST API**
- **Bun only** for package management (`bun add`, not `npm install`)

### Rollback Strategy
Set `DATA_SOURCE=graphql` in Coolify env vars for instant rollback to GraphQL-only mode (no redeploy needed). If any `MYSQL_*` env var is missing, `isMySQLConfigured()` returns false and the system automatically falls back to GraphQL. All MySQL code paths are wrapped in try/catch with fallthrough.

### Scripts
Located in `scripts/`, using shared DB module at `scripts/lib/db.ts`:
- Import: `import-products-direct.ts`, `import-images.ts`, `import-videos.ts`
- Cleanup: `cleanup-titles.ts`, `cleanup-tags.ts`, `normalize-tag-caps.ts`
- Updates: `update-prices.ts`, `update-brand-name.ts`, `variation-updater.ts`
- Analysis: `detect-missed-variations.ts`, `analyze-title-patterns.ts`
- DB: `db-clone-direct.sh`, `db-push-direct.sh` (+ remote variants)
- Cache: `warm-cache.ts` — post-deploy cache warming (categories + top products)
