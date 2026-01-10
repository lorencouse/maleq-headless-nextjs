# Content Migration Guide

This guide will help you migrate posts, comments, users, and WooCommerce orders from your production site to your staging site.

## Overview

**Source (Production):**
- Host: 127.0.0.1:3306
- Database: `maleqdb`
- User: `maleqcom`

**Destination (Staging):**
- Host: 127.0.0.1:3306
- Database: `maleq-staging`
- User: `maleq-staging`

## What Gets Migrated

✅ **Users** who have:
- Written published posts
- Left approved comments
- Made WooCommerce purchases

✅ **Posts:**
- All published blog posts
- Post metadata
- Categories and tags

✅ **Comments:**
- All approved comments
- Threaded/nested comment relationships
- Comment metadata

✅ **WooCommerce Orders:**
- Complete order history
- Order metadata
- Order items and item metadata
- Customer relationships

❌ **What Stays Fresh:**
- WordPress settings
- Theme configurations
- Plugin settings
- Media library (must be copied separately)
- Products (migrate separately if needed)
- Other post types

## Prerequisites

1. **Backup your staging database** (just in case):
   ```bash
   mysqldump -u maleq-staging -p maleq-staging > staging-backup-$(date +%Y%m%d).sql
   # Password: rpN5cAEDRS782RiGbURs
   ```

2. **Ensure both databases are accessible** from your current location

3. **Have WordPress installed** on staging with WooCommerce plugin activated

## Migration Steps

### Step 1: Create Database Backup

```bash
# Backup staging database before migration
mysqldump -u maleq-staging -p maleq-staging > staging-backup-$(date +%Y%m%d).sql
```

### Step 2: Run the Migration Script

```bash
# Execute the migration
mysql -u maleq-staging -p maleq-staging < migrate-content.sql
```

Enter password when prompted: `rpN5cAEDRS782RiGbURs`

### Step 3: Verify the Migration

After running the script, verify the data was migrated:

```bash
mysql -u maleq-staging -p maleq-staging -e "
SELECT
    'Users' as Type, COUNT(*) as Count FROM wp_users
UNION ALL
SELECT 'Posts', COUNT(*) FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'
UNION ALL
SELECT 'Comments', COUNT(*) FROM wp_comments WHERE comment_approved = '1'
UNION ALL
SELECT 'Orders', COUNT(*) FROM wp_posts WHERE post_type = 'shop_order';
"
```

### Step 4: Migrate Media Files (Optional)

If you want to migrate media files (images, uploads):

```bash
# If on same server, you can rsync the uploads directory
# Adjust paths as needed for your WordPress installation

rsync -av /path/to/production/wp-content/uploads/ /path/to/staging/wp-content/uploads/
```

Or if databases are on different servers, use SSH:

```bash
rsync -av -e ssh user@production-server:/path/to/wp-content/uploads/ /path/to/staging/wp-content/uploads/
```

### Step 5: Update Site URLs in Staging

After migration, update WordPress URLs to point to your staging domain:

```bash
mysql -u maleq-staging -p maleq-staging -e "
UPDATE wp_options SET option_value = 'https://staging.maleq.com' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'https://staging.maleq.com' WHERE option_name = 'home';
"
```

### Step 6: Clear Caches

In WordPress admin:
1. Clear any caching plugins
2. Go to **WooCommerce > Status > Tools**
3. Run: "Clear transients"
4. Run: "Regenerate shop thumbnails" (if you migrated media)

## Troubleshooting

### Issue: "Access denied" error
**Solution:** Verify database credentials are correct:
```bash
mysql -u maleq-staging -p -h 127.0.0.1
# Enter password: rpN5cAEDRS782RiGbURs
```

### Issue: Duplicate entry errors
**Solution:** The script is designed to skip duplicates. If you see these errors, it means some content already exists. This is normal if running the script multiple times.

### Issue: Missing images
**Solution:** Images are stored in `wp-content/uploads/` and need to be copied separately (see Step 4).

### Issue: Wrong user IDs on posts/comments
**Solution:** The script automatically remaps user IDs. If you still see issues, the user might not have been migrated because they didn't meet the criteria (post author, commenter, or customer).

## Post-Migration Checklist

- [ ] Verify post count matches expectations
- [ ] Check that post authors are correctly assigned
- [ ] Test comment display on posts
- [ ] Verify WooCommerce orders are visible in admin
- [ ] Confirm customer accounts can log in
- [ ] Check that media/images display (or migrate them)
- [ ] Update site URLs to staging domain
- [ ] Clear all caches
- [ ] Test GraphQL endpoint with a sample query

## Rollback Procedure

If something goes wrong, restore from backup:

```bash
mysql -u maleq-staging -p maleq-staging < staging-backup-YYYYMMDD.sql
```

## Re-running the Migration

The script is designed to be idempotent (safe to run multiple times). It will:
- Skip users that already exist (by login name)
- Skip posts that already exist (by slug)
- Skip duplicate metadata

To refresh the migration:
1. Restore from backup
2. Run the migration script again

## Notes

- The migration preserves all relationships (post authors, comment authors, order customers)
- User passwords are migrated (users can log in with their existing passwords)
- WooCommerce customer data and order history remain intact
- Post slugs are preserved (good for SEO)
- The script uses temporary tables for ID mapping and cleans up after itself

## Need Help?

If you encounter issues:
1. Check the error message - it usually indicates the exact problem
2. Verify database credentials
3. Ensure WordPress and WooCommerce are properly installed on staging
4. Check that both databases use the `wp_` table prefix (adjust script if different)
