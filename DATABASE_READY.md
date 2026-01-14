# ✅ Database Setup Complete!

## Current Status

✅ **PostgreSQL installed and running**
✅ **Database created**: `maleq_products`
✅ **User created**: `maleq_user`
✅ **Tables created**: All 6 tables ready
✅ **Connection configured**: [.env.local](.env.local)
✅ **Prisma client generated**: Ready to use
⏳ **Products**: 0 (need to sync)

## What Just Happened

I've automatically set up your PostgreSQL database:

1. Created database `maleq_products`
2. Created user `maleq_user` with password `changeme123`
3. Updated [.env.local](.env.local) with connection string
4. Created all database tables:
   - `Manufacturer` - Product brands
   - `ProductType` - Categories with hierarchy
   - `Product` - Full product data
   - `ProductImage` - Product images
   - `StockHistory` - Stock change tracking
   - `SyncLog` - Sync operation logs
5. Verified connection works

## Next: Import Products from Williams Trading

### Step 1: Start Development Server

```bash
~/.bun/bin/bun dev
```

**Important:** You need to restart the dev server if it's already running to pick up the new `DATABASE_URL` environment variable.

### Step 2: Run Initial Sync

In a new terminal, run the full sync (takes 10-30 minutes):

```bash
curl -X POST http://localhost:3000/api/admin/sync/full
```

**Or** sync step-by-step for more control:

```bash
# 1. Sync manufacturers (brands)
curl -X POST http://localhost:3000/api/admin/sync/manufacturers

# 2. Sync product types (categories)
curl -X POST http://localhost:3000/api/admin/sync/product-types

# 3. Sync products (main data)
curl -X POST http://localhost:3000/api/admin/sync/products

# 4. Sync product images
curl -X POST http://localhost:3000/api/admin/sync/images
```

### Step 3: Visit Your Shop

Once sync completes, visit: http://localhost:3000/shop

You'll see products from **both WordPress and Williams Trading**!

## Quick Database Access

### View Database in Browser

```bash
~/.bun/bin/bun prisma studio
```

Opens at: http://localhost:5555

### Command Line Access

```bash
/opt/homebrew/opt/postgresql@15/bin/psql maleq_products
```

Common queries:
```sql
-- Count products
SELECT COUNT(*) FROM "Product";

-- Count manufacturers
SELECT COUNT(*) FROM "Manufacturer";

-- View recent syncs
SELECT * FROM "SyncLog" ORDER BY "startedAt" DESC LIMIT 5;

-- View products with stock
SELECT name, "stockQuantity", "stockStatus" FROM "Product" LIMIT 10;
```

### Test Database Connection

```bash
~/.bun/bin/bun run test-db-connection.js
```

## Database Credentials

- **Host**: localhost
- **Port**: 5432
- **Database**: maleq_products
- **User**: maleq_user
- **Password**: changeme123

Connection string in [.env.local:13](.env.local#L13)

## Monitoring Sync Progress

While sync is running, you can monitor progress:

```bash
# In psql
/opt/homebrew/opt/postgresql@15/bin/psql maleq_products

# Run these queries:
SELECT COUNT(*) FROM "Manufacturer";
SELECT COUNT(*) FROM "ProductType";
SELECT COUNT(*) FROM "Product";
SELECT * FROM "SyncLog" ORDER BY "startedAt" DESC LIMIT 1;
```

## What Happens Automatically

Once products are synced:

1. **Shop page** will show products from both WordPress and Williams Trading
2. **Stock updates** will run hourly when shop is accessed
3. **Categories and manufacturers** will appear in filter dropdowns
4. **Images** will load from Williams Trading CDN
5. **Stock history** will track all quantity changes

## Troubleshooting

### "Connection refused"

PostgreSQL might not be running:
```bash
brew services restart postgresql@15
```

### "Authentication failed"

Password might be incorrect. Reset it:
```bash
/opt/homebrew/opt/postgresql@15/bin/psql postgres -c "ALTER USER maleq_user WITH PASSWORD 'changeme123';"
```

### "Dev server not picking up DATABASE_URL"

Restart the dev server after changing [.env.local](.env.local)

### "Sync is taking too long"

This is normal for the first sync. Subsequent syncs are much faster:
- Full sync: 10-30 minutes (first time)
- Stock updates: 1-2 minutes (subsequent)

## Production Notes

Before deploying to production:

1. **Change password** in [.env.local](.env.local)
2. **Use managed PostgreSQL** (Railway, Supabase, Neon, etc.)
3. **Add authentication** to sync endpoints
4. **Set up cron job** for automated stock updates
5. **Configure backups** for PostgreSQL

See [WILLIAMS_TRADING_SETUP.md](WILLIAMS_TRADING_SETUP.md) for full production setup guide.

## Files Created

- [prisma/schema.prisma](prisma/schema.prisma) - Database schema
- [lib/prisma.ts](lib/prisma.ts) - Database client
- [lib/williams-trading/client.ts](lib/williams-trading/client.ts) - API client
- [lib/williams-trading/sync-service.ts](lib/williams-trading/sync-service.ts) - Sync logic
- [lib/products/combined-service.ts](lib/products/combined-service.ts) - Product queries
- [app/api/admin/sync/](app/api/admin/sync/) - Admin API routes
- [test-db-connection.js](test-db-connection.js) - Connection test script

## Ready to Sync!

Your database is ready. Follow the steps above to import products from Williams Trading warehouse.

**Questions?** See [WILLIAMS_TRADING_SETUP.md](WILLIAMS_TRADING_SETUP.md) for detailed documentation.
