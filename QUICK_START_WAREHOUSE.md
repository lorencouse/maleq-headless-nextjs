# Williams Trading Integration - Quick Start

## Current Status

✅ **Prisma Client Generated** - Database schema is ready
⏳ **Database Setup Required** - PostgreSQL needs to be configured
⏳ **Initial Sync Pending** - Products need to be imported

## What's Working Now

Your shop page will currently show **WordPress products only** until you complete the database setup. Once configured, it will automatically show products from both sources.

## Quick Setup (5 minutes)

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Already installed?** Skip to step 2.

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Run these commands:
CREATE DATABASE maleq_products;
CREATE USER maleq_user WITH ENCRYPTED PASSWORD 'changeme123';
GRANT ALL PRIVILEGES ON DATABASE maleq_products TO maleq_user;
\q
```

### 3. Update Environment Variable

Edit `.env.local` and replace line 14:

```bash
DATABASE_URL="postgresql://maleq_user:changeme123@localhost:5432/maleq_products?schema=public"
```

### 4. Push Database Schema

```bash
~/.bun/bin/bun prisma db push
```

### 5. Run Initial Sync

```bash
# Make sure dev server is running
~/.bun/bin/bun dev

# In another terminal:
curl -X POST http://localhost:3000/api/admin/sync/full
```

This will take 10-30 minutes depending on product count.

### 6. View Results

Visit: http://localhost:3000/shop

You should now see products from both WordPress AND Williams Trading!

## Quick Commands

```bash
# View database in browser
~/.bun/bin/bun prisma studio

# Sync only manufacturers
curl -X POST http://localhost:3000/api/admin/sync/manufacturers

# Sync only products
curl -X POST http://localhost:3000/api/admin/sync/products

# Update stock only (fast)
curl -X POST http://localhost:3000/api/admin/sync/stock
```

## Troubleshooting

**"Can't connect to database"**
- Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL in `.env.local`
- Restart dev server after changing `.env.local`

**"Connection refused"**
```bash
# macOS: Start PostgreSQL
brew services start postgresql@15

# Linux: Start PostgreSQL
sudo systemctl start postgresql
```

**"Sync takes too long"**
- This is normal for first sync
- Subsequent syncs are much faster
- Stock updates take only 1-2 minutes

## What Happens Automatically

1. **Stock Updates**: Every hour when shop page is accessed
2. **Revalidation**: Page cache refreshes hourly
3. **Error Handling**: Falls back to WordPress if database unavailable

## Need More Help?

See full documentation: [WILLIAMS_TRADING_SETUP.md](WILLIAMS_TRADING_SETUP.md)

## File Structure

```
lib/
  ├── williams-trading/
  │   ├── client.ts         # API client
  │   ├── sync-service.ts   # Sync logic
  │   ├── stock-updater.ts  # Hourly updates
  │   └── types.ts          # TypeScript types
  ├── products/
  │   └── combined-service.ts  # Unified product queries
  └── prisma.ts             # Database client

app/
  ├── api/admin/sync/       # Admin endpoints
  │   ├── full/             # Full sync
  │   ├── manufacturers/    # Sync brands
  │   ├── product-types/    # Sync categories
  │   ├── products/         # Sync products
  │   ├── images/           # Sync images
  │   └── stock/            # Stock updates
  └── shop/
      └── page.tsx          # Shop page (updated)

prisma/
  └── schema.prisma         # Database schema
```

## Configuration Options

Change product source in `app/shop/page.tsx`:

```typescript
const products = await getAllProducts({
  limit: 12,
  source: 'BOTH',        // Both sources (default)
  // source: 'WILLIAMS_TRADING',  // Warehouse only
  // source: 'WORDPRESS',         // WordPress only
});
```
