# WordPress Data Migration Guide

This guide will help you migrate all post data from your production WordPress database to staging, including featured images, metadata, categories, tags, and all relationships.

## Overview

The migration scripts will transfer:
- ✅ Categories and tags
- ✅ Media attachments (images)
- ✅ Attachment metadata (image sizes, alt text, etc.)
- ✅ Post metadata (including featured image assignments)
- ✅ Post-category and post-tag relationships
- ✅ Proper ID mapping to maintain all relationships

## Prerequisites

1. SSH access to your staging server
2. MySQL credentials for the `maleq-staging` database
3. Access to the production database `maleqdb`

## Migration Steps

### Step 1: Check Current Status

First, check what data exists in production vs staging:

```bash
mysql -u maleq-staging -p maleq-staging < check-migration-status.sql
```

This will show you:
- How many posts, categories, tags, and attachments exist in both databases
- Which posts in production have featured images
- What's missing in staging

### Step 2: Run the Complete Migration

Execute the comprehensive migration script:

```bash
mysql -u maleq-staging -p maleq-staging < migrate-all-post-data.sql
```

This script will:
1. Migrate all categories
2. Migrate all tags
3. Migrate all media attachments (images, PDFs, etc.)
4. Migrate attachment metadata (image dimensions, alt text, etc.)
5. Migrate all post metadata (including featured image assignments)
6. Connect posts to their categories and tags
7. Update all counts

**Important**: The script uses `INSERT IGNORE` so it's safe to run multiple times. It won't duplicate data.

### Step 3: Verify the Migration

Check that featured images were migrated correctly:

```bash
mysql -u maleq-staging -p maleq-staging < verify-featured-images.sql
```

This will show:
- How many posts have featured images
- Sample posts with their featured image URLs
- Any posts missing featured images

### Step 4: Sync Image Files

The SQL migration only migrates database records. You also need to copy the actual image files from production to staging:

```bash
# SSH into your staging server
ssh your-staging-server

# Sync wp-content/uploads directory from production
rsync -avz --progress \
  production-server:/path/to/wp-content/uploads/ \
  /path/to/staging/wp-content/uploads/
```

Or if you have direct database access:

```bash
# From your local machine or staging server
scp -r production-server:/var/www/html/wp-content/uploads/* \
  /var/www/html/wp-content/uploads/
```

### Step 5: Test in GraphQL

After migration, test that featured images appear in the GraphQL API:

```bash
curl -X POST "https://staging.maleq.com/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"query{posts(first:5){nodes{id title featuredImage{node{sourceUrl}}}}}"}' \
  | jq '.data.posts.nodes'
```

You should now see `featuredImage` populated with actual image URLs instead of `null`.

### Step 6: Verify in Your Next.js App

1. Restart your Next.js dev server (if running)
2. Visit `http://localhost:3000/blog`
3. Featured images should now appear on all blog cards
4. Click into individual posts to verify featured images display there too

## Troubleshooting

### Issue: Images still showing as null in GraphQL

**Possible causes:**
1. The migration script didn't run completely - check for errors
2. The `_thumbnail_id` values in `wp_postmeta` don't match attachment IDs
3. The attachments weren't migrated

**Solution:**
Run the verification script to see which posts are missing featured images:
```bash
mysql -u maleq-staging -p maleq-staging < verify-featured-images.sql
```

### Issue: Images appear in database but return 404

**Cause:** The image files weren't copied from production to staging.

**Solution:**
Complete Step 4 above to sync the `wp-content/uploads` directory.

### Issue: Some posts have images, others don't

**Possible causes:**
1. Those posts didn't have featured images in production
2. The attachments for those images don't exist in production
3. File permissions issue

**Solution:**
1. Check production to see if those posts have featured images
2. Run `check-migration-status.sql` to compare counts
3. Check file permissions: `chmod -R 755 wp-content/uploads`

### Issue: GraphQL still returns null after migration

**Possible causes:**
1. WordPress object cache needs clearing
2. WPGraphQL needs to be updated

**Solution:**
```bash
# SSH into staging server
wp cache flush --path=/var/www/html

# Or if using Redis/Memcached
wp cache flush --allow-root
```

## Migration Script Details

### What Gets Migrated

The `migrate-all-post-data.sql` script migrates in this order:

1. **Categories**: All category terms and taxonomy relationships
2. **Tags**: All tag terms and taxonomy relationships
3. **Attachments**: All media files (images, PDFs, etc.) as post records
4. **Attachment Metadata**: Image dimensions, file paths, alt text, etc.
5. **Post Metadata**: All custom fields, SEO data, and **featured image assignments** (`_thumbnail_id`)
6. **Term Relationships**: Connections between posts and their categories/tags
7. **Counts**: Updates post counts for categories and tags

### Safety Features

- Uses `INSERT IGNORE` to prevent duplicate entries
- Maps old IDs to new IDs to maintain relationships
- Preserves existing staging data (won't delete anything)
- Can be run multiple times safely
- Uses temporary tables for ID mapping (automatically cleaned up)

### Database Schema Mapping

| Production Table | Staging Table | Purpose |
|-----------------|---------------|---------|
| `maleqdb.p1bJcx_posts` | `wp_posts` | Posts and attachments |
| `maleqdb.p1bJcx_postmeta` | `wp_postmeta` | Post metadata (featured images, custom fields) |
| `maleqdb.p1bJcx_terms` | `wp_terms` | Category and tag names |
| `maleqdb.p1bJcx_term_taxonomy` | `wp_term_taxonomy` | Taxonomy definitions |
| `maleqdb.p1bJcx_term_relationships` | `wp_term_relationships` | Post-to-term connections |

## After Migration

Once the migration is complete and verified:

1. ✅ Featured images should appear in the blog listing
2. ✅ Featured images should appear in individual blog posts
3. ✅ Categories and tags should be properly assigned
4. ✅ All post metadata should be preserved
5. ✅ Image alt text and dimensions should be available

## Questions?

If you encounter any issues not covered here, check:
1. MySQL error logs: `/var/log/mysql/error.log`
2. WordPress debug log: `wp-content/debug.log` (if WP_DEBUG is enabled)
3. GraphQL query results to see the exact data structure being returned
