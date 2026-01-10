# Project TODO

## Current Tasks

### 1. Set Up Staging Environment
- [ ] Configure DNS for staging.maleq.com subdomain
- [ ] Set up web server (Apache/Nginx) to handle staging subdomain
- [ ] Install SSL certificate with Let's Encrypt
- [ ] Install WordPress on staging subdomain (clone from production or fresh install)
- [ ] Install required WordPress plugins:
  - [ ] WPGraphQL
  - [ ] WPGraphQL for WooCommerce
- [ ] Verify GraphQL endpoint is working at https://staging.maleq.com/graphql
- [ ] Update `.env.local` with staging URL
- [ ] Update `next.config.ts` to allow images from staging.maleq.com
- [ ] Test Next.js app connects to staging successfully

**Reference:** See [STAGING_SETUP.md](STAGING_SETUP.md) for detailed instructions

---

## Completed

### Initial Setup
- [x] Migrated from npm to bun
- [x] Installed bun v1.3.5
- [x] Confirmed Next.js 15.5.7 installation
- [x] Upgraded to Tailwind CSS v4.0.0
- [x] Installed @tailwindcss/postcss plugin
- [x] Updated PostCSS configuration for Tailwind v4
- [x] Removed experimental PPR config (requires canary)
- [x] Identified SSL/connection issues with IP-based WordPress URL
- [x] Created staging environment setup guide

---

## Notes

- Production site at maleq.com has live traffic and sales - DO NOT use for testing
- Development environment needs staging.maleq.com subdomain
- Using bun for package management (faster than npm)
- Tailwind CSS v4 uses CSS-based configuration (@theme inline)
