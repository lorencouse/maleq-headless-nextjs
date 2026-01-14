# Williams Trading Warehouse Integration Setup Guide

This guide will help you set up and configure the Williams Trading warehouse API integration for your Next.js e-commerce store.

## Overview

The integration provides:
- Automatic product synchronization from Williams Trading API
- Category hierarchy matching warehouse structure
- Hourly stock quantity updates
- Support for both WordPress and Williams Trading products
- Complete product data including images, pricing, and stock status

## Prerequisites

1. PostgreSQL database installed and running
2. Bun package manager installed
3. Williams Trading wholesale account (for API access)

## Step 1: Database Setup

### Install PostgreSQL

If you don't have PostgreSQL installed:

**macOS (using Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE maleq_products;
CREATE USER maleq_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE maleq_products TO maleq_user;

# Exit psql
\q
```

## Step 2: Configure Environment Variables

Update your [.env.local](.env.local) file with your database credentials:

```bash
# PostgreSQL Database URL
DATABASE_URL="postgresql://maleq_user:your_secure_password@localhost:5432/maleq_products?schema=public"

# Williams Trading API Configuration (already configured)
WILLIAMS_TRADING_API_URL=http://wholesale.williams-trading.com/rest
WILLIAMS_TRADING_IMAGE_BASE=http://images.williams-trading.com/product_images
```

## Step 3: Run Database Migration

Generate Prisma client and create database tables:

```bash
# Generate Prisma client
~/.bun/bin/bun prisma generate

# Create database tables
~/.bun/bin/bun prisma db push

# Optional: Open Prisma Studio to view your database
~/.bun/bin/bun prisma studio
```

**Note:** The project uses Prisma 5.22.0 (stable version). If you encounter any issues with Prisma 7.x, the correct version has already been installed.

## Step 4: Initial Data Sync

Now you can sync data from Williams Trading API to your database.

### Option A: Full Sync (Recommended for first time)

This will sync manufacturers, product types, products, and images in sequence:

```bash
curl -X POST http://localhost:3000/api/admin/sync/full
```

**Note:** This may take 10-30 minutes depending on the number of products.

### Option B: Incremental Sync (Manual control)

Sync each data type separately:

```bash
# 1. Sync manufacturers first
curl -X POST http://localhost:3000/api/admin/sync/manufacturers

# 2. Then sync product types (categories)
curl -X POST http://localhost:3000/api/admin/sync/product-types

# 3. Sync products (requires manufacturers and types to be synced first)
curl -X POST http://localhost:3000/api/admin/sync/products

# 4. Finally sync product images (requires products to be synced first)
curl -X POST http://localhost:3000/api/admin/sync/images
```

## Step 5: Verify Setup

1. Start your development server:
```bash
~/.bun/bin/bun dev
```

2. Visit [http://localhost:3000/shop](http://localhost:3000/shop)

3. You should see products from both WordPress and Williams Trading

4. Check Prisma Studio to verify data:
```bash
~/.bun/bin/bun prisma studio
```

## How It Works

### Automatic Stock Updates

The shop page is configured to check if stock needs updating every time it's accessed:

- Stock is refreshed automatically every hour
- The check happens in the background and doesn't slow down page loads
- Updates only products that have changed stock quantities
- Tracks stock history for analytics

You can see this in [app/shop/page.tsx:4](app/shop/page.tsx#L4):
```typescript
export const revalidate = 3600; // Revalidate every hour
```

### Product Sources

The system supports products from multiple sources:

```typescript
// In app/shop/page.tsx
const products = await getAllProducts({
  limit: 12,
  source: 'BOTH', // Options: 'WORDPRESS', 'WILLIAMS_TRADING', 'BOTH'
});
```

Change the `source` parameter to control which products are displayed:
- `'BOTH'` - Mix of WordPress and Williams Trading products (default)
- `'WILLIAMS_TRADING'` - Only warehouse products
- `'WORDPRESS'` - Only WordPress/WooCommerce products

### Category Hierarchy

Products are organized using Williams Trading's category structure:
- Categories are stored in the `ProductType` table
- Supports parent-child relationships for nested categories
- Each product can belong to one category

### Filtering

The combined service supports filtering by:
- Category
- Manufacturer
- Search terms
- Stock availability
- Price range (can be added)

Example:
```typescript
const products = await getAllProducts({
  limit: 20,
  category: 'VIBRATORS', // Product type code
  manufacturer: 'DOC_JOHNSON', // Manufacturer code
  inStock: true, // Only in-stock items
  search: 'silicone', // Text search
});
```

## API Endpoints

### Admin Sync Endpoints

All endpoints accept POST requests:

- `POST /api/admin/sync/full` - Full sync (all data)
- `POST /api/admin/sync/manufacturers` - Sync manufacturers only
- `POST /api/admin/sync/product-types` - Sync categories only
- `POST /api/admin/sync/products` - Sync products only
- `POST /api/admin/sync/images` - Sync product images only
- `POST /api/admin/sync/stock` - Quick stock quantity update

### Response Format

```json
{
  "success": true,
  "message": "Products sync completed",
  "data": {
    "added": 150,
    "updated": 320,
    "failed": 2
  }
}
```

## Database Schema

The integration uses the following tables:

- **Manufacturer** - Product manufacturers (e.g., Doc Johnson, Pipedream)
- **ProductType** - Product categories with hierarchy support
- **Product** - Main product data with pricing and stock
- **ProductImage** - Product images with sort order
- **StockHistory** - Historical stock quantity changes
- **SyncLog** - Logs of all sync operations

See [prisma/schema.prisma](prisma/schema.prisma) for full schema.

## Maintenance

### Regular Stock Updates

Stock is automatically updated when the shop page is accessed (max once per hour). For more frequent updates, set up a cron job:

```bash
# Add to crontab (every 30 minutes)
*/30 * * * * curl -X POST http://localhost:3000/api/admin/sync/stock
```

### Full Re-sync

To refresh all product data:

```bash
curl -X POST http://localhost:3000/api/admin/sync/full
```

### Monitor Sync Status

Check sync logs in the database:

```bash
~/.bun/bin/bun prisma studio
# Navigate to SyncLog table
```

## Customization

### Changing Sync Behavior

Edit [lib/williams-trading/sync-service.ts](lib/williams-trading/sync-service.ts) to customize:
- Stock status thresholds (LOW_STOCK, OUT_OF_STOCK)
- Product filtering logic
- Image handling
- Error handling

### Adding Authentication

To secure admin endpoints, uncomment the authentication check in the API routes:

```typescript
// In app/api/admin/sync/*/route.ts
const authHeader = request.headers.get('authorization');
if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Then add to [.env.local](.env.local):
```bash
ADMIN_API_KEY=your_secure_random_string_here
```

## Troubleshooting

### Database Connection Issues

If you see "Can't reach database server":
1. Check PostgreSQL is running: `pg_isready`
2. Verify DATABASE_URL in [.env.local](.env.local)
3. Check firewall settings
4. Ensure database exists: `psql -l`

### Sync Failures

Check the SyncLog table for error messages:
```bash
~/.bun/bin/bun prisma studio
```

Common issues:
- Network connectivity to Williams Trading API
- Rate limiting (add delays in sync-service.ts)
- Missing parent relationships (sync manufacturers/types first)

### Missing Images

Images are hosted on Williams Trading's CDN:
- Ensure `WILLIAMS_TRADING_IMAGE_BASE` is correct
- Check product has images in API response
- Images may be served over HTTP (not HTTPS)

### Performance Issues

For large catalogs (10,000+ products):
- Increase sync timeout in [app/api/admin/sync/full/route.ts:4](app/api/admin/sync/full/route.ts#L4)
- Use incremental sync instead of full sync
- Consider running sync as background job
- Add database indexes for frequently filtered fields

## Production Deployment

### Environment Variables

Add to production environment:
```bash
DATABASE_URL="postgresql://user:pass@host:5432/db"
WILLIAMS_TRADING_API_URL=http://wholesale.williams-trading.com/rest
WILLIAMS_TRADING_IMAGE_BASE=http://images.williams-trading.com/product_images
ADMIN_API_KEY=your_production_api_key
```

### Cron Job Setup

Set up automated stock updates:

**Using Vercel Cron:**
1. Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/admin/sync/stock",
    "schedule": "0 * * * *"
  }]
}
```

**Using External Cron Service:**
Use services like cron-job.org or EasyCron to hit your sync endpoints.

### Database Backups

Set up regular PostgreSQL backups:
```bash
pg_dump -U maleq_user maleq_products > backup.sql
```

## Support

For issues with:
- **Williams Trading API**: Contact Williams Trading support
- **This integration**: Check the code in `/lib/williams-trading/`
- **Prisma**: See [prisma.io/docs](https://www.prisma.io/docs)
- **Next.js**: See [nextjs.org/docs](https://nextjs.org/docs)

## File Reference

Key files in this integration:

- [prisma/schema.prisma](prisma/schema.prisma) - Database schema
- [lib/williams-trading/client.ts](lib/williams-trading/client.ts) - API client
- [lib/williams-trading/sync-service.ts](lib/williams-trading/sync-service.ts) - Sync logic
- [lib/products/combined-service.ts](lib/products/combined-service.ts) - Product queries
- [app/shop/page.tsx](app/shop/page.tsx) - Shop page using products
- [app/api/admin/sync/](app/api/admin/sync/) - Admin API routes
