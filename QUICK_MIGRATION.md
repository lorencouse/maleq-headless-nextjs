# Quick Migration Steps

Follow these steps to migrate your content from production to staging.

## TL;DR - Just run these commands:

```bash
# 1. Test database connections
./test-db-connection.sh

# 2. Backup staging database (optional but recommended)
mysqldump -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging > staging-backup-$(date +%Y%m%d).sql

# 3. Run the migration
mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging < migrate-content.sql

# 4. Verify the migration
mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging -e "
SELECT 'Users' as Type, COUNT(*) as Count FROM wp_users
UNION ALL
SELECT 'Posts', COUNT(*) FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'
UNION ALL
SELECT 'Comments', COUNT(*) FROM wp_comments WHERE comment_approved = '1'
UNION ALL
SELECT 'Orders', COUNT(*) FROM wp_posts WHERE post_type = 'shop_order';
"
```

## What This Does

The migration script will copy from **production** (`maleqdb`) to **staging** (`maleq-staging`):

✅ All published blog posts
✅ All approved comments
✅ All WooCommerce orders
✅ Users who wrote posts, left comments, or made purchases
✅ All metadata and relationships

It will NOT affect:
- WordPress settings
- Plugins
- Themes
- Products (unless you want to migrate those too)
- Media files (copy separately)

## After Migration

1. **Update site URLs** (if needed):
   ```bash
   mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging -e "
   UPDATE wp_options SET option_value = 'https://staging.maleq.com' WHERE option_name = 'siteurl';
   UPDATE wp_options SET option_value = 'https://staging.maleq.com' WHERE option_name = 'home';
   "
   ```

2. **Copy media files** (if needed):
   ```bash
   # Adjust paths for your WordPress installation
   rsync -av /path/to/production/wp-content/uploads/ /path/to/staging/wp-content/uploads/
   ```

3. **Clear WordPress caches** in admin

## If Something Goes Wrong

Restore from backup:
```bash
mysql -u maleq-staging -prpN5cAEDRS782RiGbURs maleq-staging < staging-backup-YYYYMMDD.sql
```

## Files in This Directory

- **[migrate-content.sql](migrate-content.sql)** - Main migration script
- **[test-db-connection.sh](test-db-connection.sh)** - Tests database connectivity
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** - Detailed migration documentation
- **This file** - Quick reference

## Need More Details?

See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for complete documentation, troubleshooting, and advanced options.
