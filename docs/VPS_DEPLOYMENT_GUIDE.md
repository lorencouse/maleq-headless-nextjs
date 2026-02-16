# VPS + Cloudflare Deployment Guide

Self-hosted deployment for Male Q on a VPS with Cloudflare CDN. Replaces Vercel to eliminate ISR write limits and reduce hosting costs.

---

## Architecture Overview

```
User → Cloudflare CDN (free) → VPS (Hetzner/DigitalOcean) → WordPress backend
         ↑ SSL, caching,          ↑ Next.js standalone
         edge rules               Docker + Coolify
```

**Estimated cost: ~$7/month** (Hetzner CAX21 $6.99 + Cloudflare free, vs $20+/month on Vercel Pro)

---

## Option A: Coolify (Recommended — Easiest)

Coolify is an open-source, self-hosted Vercel alternative. Push to deploy, automatic SSL, built-in Docker support.

### 1. Provision a VPS

**Hetzner CAX21 (ARM64 — recommended):**
- 4 vCPU (Ampere ARM), 8 GB RAM, 80 GB disk, 20 TB traffic — $6.99/mo
- ARM64 architecture — better perf/dollar than x86
- Region: Ashburn (us-east) for US users, Falkenstein (eu) for European
- OS: Ubuntu 24.04

The `node:20-alpine` Docker image supports ARM64 natively — no Dockerfile changes needed.

**Alternative — DigitalOcean:**
- Basic Droplet: 2 vCPU, 2 GB RAM — $12/mo
- Region: NYC1 or SFO3

### 2. Install Coolify

SSH into your VPS and run:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Open `http://YOUR_VPS_IP:8000` to access the Coolify dashboard.

### 3. Connect Your GitHub Repository

1. In Coolify dashboard → Sources → Add GitHub App
2. Authorize Coolify to access your repository
3. Create a new Project → Add Resource → Public Repository (or private via GitHub App)

### 4. Configure the Application

In Coolify's application settings:

- **Build Pack**: Dockerfile
- **Dockerfile Location**: `/Dockerfile`
- **Port**: 3000

### 5. Set Environment Variables

Add all environment variables in Coolify dashboard → Application → Environment Variables:

```
NODE_ENV=production
NEXT_PUBLIC_WORDPRESS_API_URL=https://wp.maleq.com/graphql
NEXT_PUBLIC_SITE_URL=https://maleq.com
NEXT_PUBLIC_IMAGE_BASE_URL=https://www.maleq.com
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
STRIPE_SECRET_KEY=sk_live_xxxxx
REVALIDATION_SECRET=your-secret
ADMIN_API_KEY=your-admin-key
WOOCOMMERCE_URL=https://wp.maleq.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx
```

Mark `NEXT_PUBLIC_*` variables as "Build Variable" so they're available during `docker build`.

### 6. Deploy

Click "Deploy" — Coolify builds the Docker image and starts the container.

### 7. Set Up Domain

In Coolify → Application → Settings:
1. Add your domain: `maleq.com`
2. Coolify can issue SSL via Let's Encrypt (if not using Cloudflare proxy)

---

## Option B: Manual Docker Deployment

If you prefer not to use Coolify.

### 1. Provision VPS (same as above)

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 3. Clone and Deploy

```bash
git clone https://github.com/YOUR_USER/maleq-headless-nextjs.git
cd maleq-headless-nextjs

# Create .env file with all variables
cp .env.example .env
nano .env  # Fill in production values

# Build and run
docker compose up -d --build
```

### 4. Set Up Reverse Proxy (Caddy)

Install Caddy for automatic SSL and reverse proxy:

```bash
sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```
maleq.com {
    reverse_proxy localhost:3000
    encode gzip zstd
}
```

```bash
sudo systemctl restart caddy
```

If using Cloudflare proxy (orange cloud), use Cloudflare Origin Certificates instead of Caddy's automatic SSL.

---

## Cloudflare CDN Configuration

### 1. Add Your Domain to Cloudflare

1. Sign up at [cloudflare.com](https://cloudflare.com) (free plan)
2. Add site → Enter `maleq.com`
3. Update your domain's nameservers to Cloudflare's (shown in dashboard)

### 2. DNS Records

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `maleq.com` | YOUR_VPS_IP | Proxied (orange cloud) |
| A | `www` | YOUR_VPS_IP | Proxied |
| CNAME | `wp` | your-wordpress-server | DNS only (grey cloud) |

### 3. SSL/TLS Settings

- **SSL mode**: Full (Strict)
- **Always Use HTTPS**: On
- **Minimum TLS Version**: 1.2
- **Automatic HTTPS Rewrites**: On

### 4. Caching Rules (Performance)

Go to **Caching → Cache Rules** and create:

**Rule 1: Cache static assets aggressively**
- Match: `URI Path contains /\_next/static/`
- Action: Cache, Edge TTL = 1 year, Browser TTL = 1 year

**Rule 2: Cache product pages at edge**
- Match: `URI Path starts with /product/`
- Action: Cache, Edge TTL = 7 days, Browser TTL = 1 hour

**Rule 3: Cache category pages**
- Match: `URI Path starts with /sex-toys/`
- Action: Cache, Edge TTL = 7 days, Browser TTL = 1 hour

**Rule 4: Cache brand pages**
- Match: `URI Path starts with /brand/`
- Action: Cache, Edge TTL = 7 days, Browser TTL = 1 hour

**Rule 5: Bypass cache for dynamic routes**
- Match: `URI Path starts with /api/` OR `URI Path starts with /cart` OR `URI Path starts with /checkout` OR `URI Path starts with /account`
- Action: Bypass Cache

### 5. Page Rules (Free plan gets 3)

1. `maleq.com/api/*` → Cache Level: Bypass
2. `maleq.com/_next/static/*` → Cache Level: Cache Everything, Edge Cache TTL: 1 month
3. `maleq.com/product/*` → Cache Level: Cache Everything, Edge Cache TTL: 7 days

### 6. Speed Settings

- **Auto Minify**: CSS, JS, HTML — all On
- **Brotli**: On
- **Early Hints**: On
- **Rocket Loader**: Off (can break Next.js hydration)

---

## Cron Jobs (Replaces Vercel Cron)

Vercel cron doesn't work outside Vercel. Set up system cron on the VPS instead.

### Stock Sync (daily at 6 AM UTC)

```bash
crontab -e
```

Add:

```
0 6 * * * curl -s http://localhost:3000/api/cron/stock-sync -H "Authorization: Bearer YOUR_ADMIN_API_KEY" > /dev/null 2>&1
```

---

## Cache Revalidation

The existing webhook system (`/api/revalidate`) works the same way on a VPS.

Update your WordPress `wp-config.php` to point to the new frontend URL:

```php
define('MALEQ_FRONTEND_URL', 'https://maleq.com');
```

When WordPress triggers a revalidation webhook, it hits your VPS directly. Cloudflare will serve the updated page on the next request.

**Important:** If using Cloudflare cache rules for product pages, you may also want to purge the Cloudflare cache on revalidation. You can add a Cloudflare API call to the revalidation endpoint, or use Cloudflare's Cache-Tag purging (requires paid plan). For the free plan, set reasonable Edge TTLs and rely on browser cache-busting.

---

## Monitoring

### Health Check

The `docker-compose.yml` includes a health check that pings `http://localhost:3000/` every 30 seconds.

### External Monitoring (Free)

- [UptimeRobot](https://uptimerobot.com) — 50 monitors free, 5-min intervals
- [Better Stack](https://betterstack.com) — Free tier with status pages

### Server Monitoring

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f web

# Check resource usage
docker stats
```

---

## Deployment Workflow

### With Coolify
Push to your configured branch → Coolify auto-builds and deploys.

### With Manual Docker
```bash
cd /path/to/maleq-headless-nextjs
git pull origin main
docker compose up -d --build
```

### GitHub Actions Auto-Deploy (Manual Docker)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /path/to/maleq-headless-nextjs
            git pull origin main
            docker compose up -d --build
```

---

## Rollback

```bash
# See recent images
docker images maleq-headless-nextjs-web

# Restart with previous image
docker compose down
git checkout HEAD~1
docker compose up -d --build
```

---

## Migration Checklist (Vercel → VPS)

- [ ] Provision VPS (Hetzner CX22 recommended)
- [ ] Install Coolify or Docker
- [ ] Set all environment variables
- [ ] Deploy and verify site loads at VPS IP:3000
- [ ] Add domain to Cloudflare, update nameservers
- [ ] Configure DNS A record pointing to VPS IP
- [ ] Set Cloudflare SSL to Full (Strict)
- [ ] Configure Cloudflare cache rules
- [ ] Update WordPress `MALEQ_FRONTEND_URL` to new domain
- [ ] Test revalidation webhook
- [ ] Set up cron job for stock sync
- [ ] Set up uptime monitoring
- [ ] Verify Stripe webhooks point to new domain
- [ ] Update Google Search Console with any domain changes
- [ ] Remove Vercel project (or keep as staging)
