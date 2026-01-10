# Featured Images Migration - Summary

## Problem Diagnosis ✅

Your featured images weren't loading because:

1. **Root Cause**: Posts in your WordPress staging database don't have featured images assigned
   - GraphQL API returns `"featuredImage": null` for all posts
   - The `wp_postmeta` table is missing `_thumbnail_id` entries that link posts to their featured images

2. **Secondary Issues Fixed**:
   - TypeScript type definitions didn't match GraphQL response structure
   - Fixed: `author`, `categories`, `tags`, and `comments` now use proper `{ node: ... }` structure
   - Next.js image configuration updated for `staging.maleq.com` domain

## What Was Created 🛠️

### Migration Scripts

1. **[check-migration-status.sql](check-migration-status.sql)**
   - Previews what data exists in production vs staging
   - Shows featured image assignments in production
   - Safe to run anytime (read-only)

2. **[migrate-all-post-data.sql](migrate-all-post-data.sql)** ⭐ MAIN MIGRATION
   - Migrates categories, tags, attachments, metadata, and relationships
   - Maps old IDs to new IDs to preserve relationships
   - Safe to run multiple times (won't duplicate data)
   - Includes featured image assignments (`_thumbnail_id`)

3. **[verify-featured-images.sql](verify-featured-images.sql)**
   - Checks migration results
   - Shows which posts have featured images
   - Lists any posts missing featured images

4. **[rollback-migration.sql](rollback-migration.sql)**
   - Emergency rollback script (preview mode by default)
   - Uncomment DELETE statements if you need to undo migration

5. **[run-migration.sh](run-migration.sh)** 🚀 EASY MODE
   - Interactive bash script to run migrations
   - Color-coded output
   - Guides you through the process
   - Usage: `./run-migration.sh`

### Documentation

6. **[MIGRATION-GUIDE.md](MIGRATION-GUIDE.md)**
   - Complete step-by-step guide
   - Troubleshooting section
   - Database schema mapping
   - Post-migration verification steps

## How to Run the Migration 🚀

### Option 1: Interactive Script (Recommended)

```bash
./run-migration.sh
```

Then select option 4 for the complete migration sequence.

### Option 2: Manual Steps

```bash
# 1. Check current status
mysql -u maleq-staging -p maleq-staging < check-migration-status.sql

# 2. Run migration
mysql -u maleq-staging -p maleq-staging < migrate-all-post-data.sql

# 3. Verify results
mysql -u maleq-staging -p maleq-staging < verify-featured-images.sql
```

### Option 3: Remote Execution

If you need to run this on your staging server:

```bash
# Upload scripts
scp *.sql run-migration.sh your-server:/path/to/wordpress/

# SSH and run
ssh your-server
cd /path/to/wordpress
./run-migration.sh
```

## What Gets Migrated 📦

The migration script handles:

- ✅ **Categories**: All categories with proper hierarchy
- ✅ **Tags**: All post tags
- ✅ **Media Attachments**: All images, PDFs, and other media
- ✅ **Attachment Metadata**: Image dimensions, alt text, file paths
- ✅ **Post Metadata**: Custom fields, SEO data, **featured image links**
- ✅ **Term Relationships**: Post-to-category and post-to-tag connections
- ✅ **Counts**: Updates all taxonomy counts

### Database Tables Affected

| Table | What's Migrated |
|-------|----------------|
| `wp_posts` | Media attachments (post_type = 'attachment') |
| `wp_postmeta` | All post metadata including `_thumbnail_id` (featured images) |
| `wp_terms` | Category and tag names |
| `wp_term_taxonomy` | Taxonomy definitions |
| `wp_term_relationships` | Post ↔ Category/Tag connections |

## Post-Migration Steps ✨

After running the SQL migration, you need to:

### 1. Sync Image Files

The SQL migration only updates the database. Copy actual image files:

```bash
# From staging server, sync from production
rsync -avz --progress \
  production-server:/var/www/html/wp-content/uploads/ \
  /var/www/html/wp-content/uploads/
```

### 2. Clear WordPress Cache

```bash
# If using WP-CLI
wp cache flush

# Or through WordPress admin
# Visit: Tools → Site Health → Clear Cache
```

### 3. Test GraphQL API

```bash
curl -X POST "https://staging.maleq.com/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"query{posts(first:3){nodes{title featuredImage{node{sourceUrl altText}}}}}"}' \
  | jq '.data.posts.nodes'
```

You should see actual image URLs instead of `null`.

### 4. Verify in Next.js

1. Restart your dev server (the config changes require a restart)
2. Visit `http://localhost:3000/blog`
3. Featured images should now appear! 🎉

## Files Changed in Your Next.js Project 📝

### Fixed Files

1. **[lib/types/wordpress.ts](lib/types/wordpress.ts)**
   - Updated `Post` interface to match GraphQL response structure
   - Changed `author: Author` → `author: { node: Author }`
   - Changed `categories?: Category[]` → `categories?: { nodes: Category[] }`
   - Changed `tags?: Tag[]` → `tags?: { nodes: Tag[] }`
   - Changed `comments?: Comment[]` → `comments?: { nodes: Comment[] }`

2. **[components/blog/BlogCard.tsx](components/blog/BlogCard.tsx)**
   - Updated to use `post.author.node.name` instead of `post.author.name`
   - Updated to use `post.categories?.nodes` instead of `post.categories`

3. **[next.config.ts](next.config.ts)**
   - Updated image domains to allow `staging.maleq.com`
   - Changed pathname pattern to allow all paths (`/**`)

## Expected Results 🎯

After migration and file sync:

### Blog Listing Page ([/blog](http://localhost:3000/blog))
- ✅ Featured images display on all blog cards
- ✅ Images are properly sized and optimized
- ✅ Alt text is preserved
- ✅ Categories and tags display correctly

### Individual Blog Posts ([/blog/[slug]](http://localhost:3000/blog/hello-world))
- ✅ Featured image displays at top of post
- ✅ Image metadata (dimensions, alt text) preserved
- ✅ Categories and tags display correctly
- ✅ Author information displays correctly

### GraphQL API
- ✅ `featuredImage` field returns image URL instead of `null`
- ✅ `categories` and `tags` return proper data
- ✅ `author` returns name and avatar

## Troubleshooting 🔧

### Images still null after migration?

**Check database:**
```bash
mysql -u maleq-staging -p maleq-staging < verify-featured-images.sql
```

**Check GraphQL:**
```bash
curl -X POST "https://staging.maleq.com/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"query{posts(first:1){nodes{featuredImage{node{sourceUrl}}}}}"}' | jq
```

### Images in database but showing 404?

**Cause:** Image files not synced from production.

**Fix:** Run the rsync command from step 1 above.

### Some posts have images, others don't?

**Cause:** Those posts didn't have featured images in production.

**Fix:** Check production database or assign featured images manually in WordPress admin.

## Support 💬

If you encounter issues:

1. Check the [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) troubleshooting section
2. Run `verify-featured-images.sql` to see current state
3. Check MySQL error logs: `/var/log/mysql/error.log`
4. Check WordPress debug log if WP_DEBUG is enabled

## Summary 📊

### What Was Wrong
- Posts in staging didn't have featured images assigned in the database
- Type definitions didn't match GraphQL response structure

### What Was Fixed
- Created comprehensive migration scripts to transfer all post data
- Fixed TypeScript types to match actual GraphQL response
- Updated Next.js image configuration
- Provided complete documentation and troubleshooting guides

### Next Steps
1. Run the migration: `./run-migration.sh`
2. Sync image files from production
3. Test in your Next.js app
4. Enjoy your featured images! 🎉
