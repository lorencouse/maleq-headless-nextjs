# Quick Start - Featured Images Migration

## TL;DR 🚀

Your featured images aren't loading because the WordPress staging database doesn't have them assigned to posts. Here's how to fix it:

## 3-Step Fix

### Step 1: Run Migration Script

```bash
./run-migration.sh
# Select option 4 (Run all)
```

**OR** manually:

```bash
mysql -u maleq-staging -p maleq-staging < migrate-all-post-data.sql
```

### Step 2: Sync Image Files

```bash
# SSH to staging server and run:
rsync -avz production:/var/www/html/wp-content/uploads/ /var/www/html/wp-content/uploads/
```

### Step 3: Verify & Test

```bash
# Test GraphQL
curl -X POST "https://staging.maleq.com/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"query{posts(first:1){nodes{title featuredImage{node{sourceUrl}}}}}"}' | jq

# Restart Next.js
# Visit http://localhost:3000/blog
```

## Files Created

| File | Purpose |
|------|---------|
| `run-migration.sh` ⭐ | Interactive script - easiest way to run migration |
| `migrate-all-post-data.sql` | Main migration script |
| `verify-featured-images.sql` | Check if it worked |
| `MIGRATION-GUIDE.md` | Full documentation |
| `MIGRATION-SUMMARY.md` | Detailed summary of what was done |

## What Was Fixed in Your Code

✅ [lib/types/wordpress.ts](lib/types/wordpress.ts) - Fixed type definitions
✅ [components/blog/BlogCard.tsx](components/blog/BlogCard.tsx) - Updated to use correct structure
✅ [next.config.ts](next.config.ts) - Added staging.maleq.com to allowed domains

## Need More Help?

- **Full guide**: Read [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md)
- **What happened**: Read [MIGRATION-SUMMARY.md](MIGRATION-SUMMARY.md)
- **Troubleshooting**: See MIGRATION-GUIDE.md → Troubleshooting section

## Expected Result

After migration:
- ✅ Blog cards show featured images
- ✅ Individual posts show featured images
- ✅ GraphQL returns image URLs (not null)
- ✅ Categories and tags work properly

## One-Liner (If You're Feeling Lucky)

```bash
mysql -u maleq-staging -p maleq-staging < migrate-all-post-data.sql && \
echo "✅ Migration complete! Now sync image files from production."
```

---

**Questions?** Check [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) for detailed help.
