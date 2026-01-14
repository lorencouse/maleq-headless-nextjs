# Williams Trading Sync Guide

Your Williams Trading product sync is now fully configured and ready to use!

## Quick Start

### 1. Start Your Development Server

```bash
npm run dev
```

### 2. Open the Sync Dashboard

Navigate to: [http://localhost:3000/admin/sync](http://localhost:3000/admin/sync)

### 3. Run Your First Sync

Click **"Run Full Sync"** to import all data from Williams Trading:
- Manufacturers
- Product Types (Categories)
- Products
- Product Images

This may take a few minutes depending on catalog size.

## Available Sync Options

### Full Sync
**Endpoint:** `POST /api/admin/sync/full`

Syncs everything in order:
1. Manufacturers
2. Product Types
3. Products
4. Product Images

**Use for:** Initial import or complete refresh

### Individual Syncs

#### Manufacturers
**Endpoint:** `POST /api/admin/sync/manufacturers`

Imports/updates all manufacturers from Williams Trading.

#### Product Types
**Endpoint:** `POST /api/admin/sync/product-types`

Imports/updates product categories and their hierarchies.

#### Products
**Endpoint:** `POST /api/admin/sync/products`

Imports/updates all products with pricing, stock, and details.

**Note:** Requires manufacturers and product types to be synced first.

#### Images
**Endpoint:** `POST /api/admin/sync/images`

Imports/updates product images from Williams Trading.

**Note:** Requires products to be synced first.

### Stock Update
**Endpoint:** `POST /api/admin/sync/stock`

Quick update of stock quantities only (doesn't update product details).

**Use for:** Scheduled hourly/daily stock updates

## Database Structure

Your products are stored in the MySQL `products` database with these tables:

### Manufacturer
Stores manufacturer/brand information from Williams Trading.

### ProductType
Product categories with support for hierarchical relationships (parent/child).

### Product
Main product data including:
- SKU, name, descriptions
- Pricing (price, retail price, sale price)
- Stock (quantity, status)
- Dimensions (weight, length, width, height)
- Relationships to manufacturers and product types

### ProductImage
Product images with SEO fields:
- `imageUrl` - Williams Trading image URL
- `localPath` - Path for locally processed images
- `imageAlt` - Alt text for SEO
- `isPrimary` - Primary product image flag

### StockHistory
Tracks all stock quantity changes over time for analytics.

### SyncLog
Logs all sync operations with success/failure counts.

## Viewing Your Data

### Option 1: phpMyAdmin
- Log into phpMyAdmin
- Select the `products` database
- Browse tables to see imported data

### Option 2: Prisma Studio (Recommended)
```bash
npx prisma studio
```

Opens a web UI at `http://localhost:5555` with a nice interface for browsing data.

## Programmatic Access

### Using Prisma in Your Code

```typescript
import { prisma } from '@/lib/prisma';

// Get all in-stock products
const products = await prisma.product.findMany({
  where: {
    stockStatus: 'IN_STOCK',
    active: true,
  },
  include: {
    manufacturer: true,
    productType: true,
    images: {
      orderBy: { sortOrder: 'asc' },
    },
  },
});

// Get a single product by SKU
const product = await prisma.product.findUnique({
  where: { sku: 'WT-12345' },
  include: {
    manufacturer: true,
    productType: true,
    images: true,
  },
});
```

### Using the Sync Service

```typescript
import { syncService } from '@/lib/williams-trading/sync-service';

// Run full sync
await syncService.fullSync();

// Sync only products
await syncService.syncProducts();

// Update stock only
await syncService.updateStock();
```

## Scheduled Syncs

### Setting Up Cron Jobs

For production, set up scheduled syncs on your server:

```bash
# Crontab example

# Full sync daily at 2 AM
0 2 * * * curl -X POST https://yourdomain.com/api/admin/sync/full

# Stock update every hour
0 * * * * curl -X POST https://yourdomain.com/api/admin/sync/stock
```

### Using Vercel Cron (If deploying to Vercel)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/admin/sync/full",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/admin/sync/stock",
      "schedule": "0 * * * *"
    }
  ]
}
```

## Security Considerations

The sync endpoints currently have **no authentication**. Before deploying to production:

### Option 1: Add API Key Authentication

Uncomment the auth check in `/app/api/admin/sync/full/route.ts`:

```typescript
const authHeader = request.headers.get('authorization');
if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Add to `.env.local`:
```
ADMIN_API_KEY=your-secure-random-key-here
```

### Option 2: IP Whitelist

Configure your hosting to only allow sync endpoints from specific IPs.

### Option 3: Password Protect Admin Pages

Use middleware or hosting-level password protection for `/admin/*` routes.

## Troubleshooting

### "Can't reach database server"

- Make sure you've run the SQL in phpMyAdmin to create tables
- Verify `DATABASE_URL` in `.env` or `.env.local` has correct credentials
- Check that MySQL is running

### "Manufacturer not found" errors during product sync

Run manufacturers sync first:
```bash
curl -X POST http://localhost:3000/api/admin/sync/manufacturers
```

### Slow syncs

This is normal for large catalogs. Consider:
- Running full sync during off-peak hours
- Using stock-only updates for frequent syncs
- Increasing `maxDuration` in route files if hitting timeouts

## Next Steps

1. **Run your first full sync** via the admin dashboard
2. **View products** in Prisma Studio or phpMyAdmin
3. **Create product listing pages** in your Next.js app
4. **Set up scheduled stock updates** for production
5. **Connect cart/checkout** to WooCommerce API

## Support

For Williams Trading API documentation:
- API Base: http://wholesale.williams-trading.com/rest
- Images: http://images.williams-trading.com/product_images

Your database is MySQL, accessible via phpMyAdmin at your hosting provider.
