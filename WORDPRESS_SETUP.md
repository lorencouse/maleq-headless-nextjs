# WordPress Headless Setup Guide

Complete guide for setting up WordPress as a headless CMS on your Hetzner server (159.69.220.162).

## Required WordPress Plugins

### 1. WPGraphQL (Required)
Enables GraphQL API for WordPress.

**Installation:**
```bash
ssh root@159.69.220.162
cd /var/www/html/wp-content/plugins  # or your WordPress path
wget https://downloads.wordpress.org/plugin/wp-graphql.latest-stable.zip
unzip wp-graphql.latest-stable.zip
rm wp-graphql.latest-stable.zip
```

**Activation:**
```bash
wp plugin activate wp-graphql
```

**Configuration:**
- Go to WordPress Admin > GraphQL > Settings
- Enable "Public Introspection" (for development)
- Set "GraphQL Endpoint": `/graphql`
- Save changes

### 2. WPGraphQL for WooCommerce (Required)
Extends WPGraphQL with WooCommerce support.

**Installation:**
```bash
cd /var/www/html/wp-content/plugins
git clone https://github.com/wp-graphql/wp-graphql-woocommerce.git
cd wp-graphql-woocommerce
composer install --no-dev
```

**Activation:**
```bash
wp plugin activate wp-graphql-woocommerce
```

### 3. WPGraphQL for Advanced Custom Fields (Optional)
If using custom fields.

```bash
wp plugin install wp-graphql-acf --activate
```

### 4. WP Webhooks (Recommended)
For triggering Next.js cache revalidation.

```bash
wp plugin install wp-webhooks --activate
```

### 5. JWT Authentication (Optional)
For authenticated requests (cart, checkout, user data).

```bash
cd /var/www/html/wp-content/plugins
git clone https://github.com/WP-API/jwt-authentication.git
wp plugin activate jwt-authentication
```

**Configuration in wp-config.php:**
```php
define('JWT_AUTH_SECRET_KEY', 'your-top-secret-key-here');
define('JWT_AUTH_CORS_ENABLE', true);
```

## WordPress Configuration

### 1. Permalink Settings
**Critical:** Set to "Post name" for GraphQL to work properly.

- Admin > Settings > Permalinks
- Select "Post name"
- Save changes

### 2. WooCommerce Settings

**Store Setup:**
- WooCommerce > Settings > General
- Fill in store address and currency

**Enable REST API:**
- WooCommerce > Settings > Advanced > REST API
- Enable REST API
- Create API keys if needed

**Product Settings:**
- WooCommerce > Settings > Products
- Configure inventory, downloads as needed

### 3. CORS Configuration

Add to `.htaccess` or in Apache config:

```apache
<IfModule mod_headers.c>
    Header set Access-Control-Allow-Origin "*"
    Header set Access-Control-Allow-Methods "GET, POST, OPTIONS"
    Header set Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization"
</IfModule>
```

Or in `wp-config.php`:
```php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
```

### 4. Security Headers

In `.htaccess`:
```apache
# Disable XML-RPC (not needed for headless)
<Files xmlrpc.php>
    order deny,allow
    deny from all
</Files>

# Protect wp-config.php
<files wp-config.php>
    order allow,deny
    deny from all
</files>
```

## Webhook Configuration

### Install WP Webhooks

1. Admin > Plugins > WP Webhooks
2. Go to WP Webhooks > Settings

### Configure Post Publish/Update Webhook

**Trigger:** Post Published or Updated

**URL:**
```
https://your-nextjs-domain.com/api/revalidate?secret=YOUR_SECRET_KEY
```

**Method:** POST

**Body:**
```json
{
  "type": "post",
  "slug": "%%post_name%%"
}
```

### Configure Product Update Webhook

**Trigger:** Product Published or Updated

**URL:**
```
https://your-nextjs-domain.com/api/revalidate?secret=YOUR_SECRET_KEY
```

**Method:** POST

**Body:**
```json
{
  "type": "product",
  "slug": "%%post_name%%"
}
```

## Database Optimization for GraphQL

Run these queries in phpMyAdmin or MySQL CLI:

```sql
-- Optimize posts table
ALTER TABLE wp_posts ADD INDEX idx_post_status_type (post_status, post_type);
ALTER TABLE wp_posts ADD INDEX idx_post_name (post_name);
ALTER TABLE wp_posts ADD INDEX idx_post_date (post_date);

-- Optimize postmeta table
ALTER TABLE wp_postmeta ADD INDEX idx_post_id (post_id);
ALTER TABLE wp_postmeta ADD INDEX idx_meta_key (meta_key(191));
ALTER TABLE wp_postmeta ADD INDEX idx_meta_key_value (meta_key(191), meta_value(191));

-- Optimize term relationships
ALTER TABLE wp_term_relationships ADD INDEX idx_term_taxonomy_id (term_taxonomy_id);

-- WooCommerce specific
ALTER TABLE wp_wc_product_meta_lookup ADD INDEX idx_stock_status (stock_status);
ALTER TABLE wp_wc_product_meta_lookup ADD INDEX idx_onsale (onsale);
```

## SSL/TLS Configuration

### Get SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
apt update
apt install certbot python3-certbot-apache

# Get certificate
certbot --apache -d your-domain.com -d www.your-domain.com

# Auto-renewal (should be automatic, but verify)
certbot renew --dry-run
```

### Update WordPress URLs

```bash
wp option update home 'https://your-domain.com'
wp option update siteurl 'https://your-domain.com'
```

Or in `wp-config.php`:
```php
define('WP_HOME', 'https://your-domain.com');
define('WP_SITEURL', 'https://your-domain.com');
```

## Performance Optimization

### Install Redis Object Cache

```bash
# Install Redis
apt install redis-server php-redis
systemctl start redis
systemctl enable redis

# Install WordPress plugin
wp plugin install redis-cache --activate

# Enable Redis
wp redis enable
```

### Configure wp-config.php

```php
// Enable Redis
define('WP_REDIS_HOST', '127.0.0.1');
define('WP_REDIS_PORT', 6379);
define('WP_CACHE', true);

// Increase memory limit
define('WP_MEMORY_LIMIT', '256M');
define('WP_MAX_MEMORY_LIMIT', '512M');

// Disable unnecessary features
define('DISABLE_WP_CRON', true); // Use system cron instead
define('WP_POST_REVISIONS', 3);  // Limit revisions
define('AUTOSAVE_INTERVAL', 300); // 5 minutes
```

### Set Up System Cron

```bash
# Edit crontab
crontab -e

# Add WordPress cron
*/5 * * * * cd /var/www/html && wp cron event run --due-now
```

## GraphQL Rate Limiting

Install and configure WPGraphQL Rate Limiting:

```bash
wp plugin install wpgraphql-rate-limit --activate
```

Configure in WordPress Admin:
- GraphQL > Settings > Rate Limiting
- Set limits (e.g., 100 requests per minute)

## Testing GraphQL Endpoint

### Test with curl

```bash
curl -X POST https://159.69.220.162/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ posts { nodes { title } } }"}'
```

### Test in GraphiQL IDE

Visit: `https://159.69.220.162/graphql`

Should see GraphiQL interface for testing queries.

### Sample Test Queries

**Get Posts:**
```graphql
query GetPosts {
  posts(first: 5) {
    nodes {
      id
      title
      slug
      date
    }
  }
}
```

**Get Products:**
```graphql
query GetProducts {
  products(first: 5) {
    nodes {
      id
      name
      slug
      price
      stockStatus
    }
  }
}
```

## Content Migration

### Export from Old WordPress

1. **Posts & Pages:**
   - Tools > Export
   - Select "Posts" and "Pages"
   - Download XML file

2. **WooCommerce Products:**
   - WooCommerce > Products
   - Click "Export"
   - Choose CSV format
   - Download file

### Import to New WordPress

1. **Posts & Pages:**
   - Tools > Import > WordPress
   - Upload XML file
   - Assign authors
   - Check "Download and import file attachments"
   - Click "Submit"

2. **WooCommerce Products:**
   - WooCommerce > Products
   - Click "Import"
   - Upload CSV file
   - Map columns
   - Run import

### Migrate Media Files

```bash
# From old server
cd /path/to/old/wp-content/uploads
tar -czf uploads.tar.gz *

# Transfer to new server
scp uploads.tar.gz root@159.69.220.162:/tmp/

# On new server
cd /var/www/html/wp-content/uploads
tar -xzf /tmp/uploads.tar.gz
chown -R www-data:www-data .
```

## Security Checklist

- [ ] Install Wordfence or similar security plugin
- [ ] Enable two-factor authentication
- [ ] Change default "admin" username
- [ ] Use strong passwords
- [ ] Keep WordPress, plugins, themes updated
- [ ] Disable file editing in wp-config.php:
  ```php
  define('DISALLOW_FILE_EDIT', true);
  ```
- [ ] Limit login attempts
- [ ] Regular database backups
- [ ] Use HTTPS only
- [ ] Hide WordPress version
- [ ] Disable directory browsing

## Backup Strategy

### Automated Backups with UpdraftPlus

```bash
wp plugin install updraftplus --activate
```

Configure:
- Settings > UpdraftPlus Backups
- Set schedule (daily for database, weekly for files)
- Configure remote storage (Dropbox, S3, etc.)

### Manual Database Backup

```bash
# Backup database
wp db export backup-$(date +%Y%m%d).sql

# Restore database
wp db import backup-20260106.sql
```

## Monitoring

### Install Health Check Plugin

```bash
wp plugin install health-check --activate
```

Check:
- Tools > Site Health
- Review any warnings or errors

### Monitor Error Logs

```bash
tail -f /var/log/apache2/error.log
# or
tail -f /var/log/nginx/error.log
```

## Useful WP-CLI Commands

```bash
# Update all plugins
wp plugin update --all

# Update WordPress core
wp core update

# Clear cache
wp cache flush

# Search and replace URLs (after domain change)
wp search-replace 'http://old-domain.com' 'https://new-domain.com'

# List all posts
wp post list --post_type=post

# List all products
wp post list --post_type=product

# Check site status
wp core check-update
wp plugin list
```

## Troubleshooting

### GraphQL Endpoint Returns 404

1. Check permalinks: Settings > Permalinks > Save
2. Check .htaccess file exists and is writable
3. Verify WPGraphQL plugin is active
4. Clear WordPress cache

### CORS Errors

1. Add CORS headers to .htaccess (see above)
2. Or use a CORS plugin: `wp plugin install wp-cors --activate`

### Slow GraphQL Queries

1. Install Query Monitor plugin
2. Enable Redis object cache
3. Add database indexes (see above)
4. Limit query depth in WPGraphQL settings

### Images Not Loading

1. Check file permissions: `chmod -R 755 wp-content/uploads`
2. Check ownership: `chown -R www-data:www-data wp-content/uploads`
3. Verify image paths in Next.js config

## Next Steps

After setup:
1. Test GraphQL endpoint with queries
2. Import content from old site
3. Configure webhooks for cache revalidation
4. Set up SSL certificate
5. Configure backups
6. Test the Next.js frontend connection
7. Monitor performance and optimize

## Resources

- [WPGraphQL Documentation](https://www.wpgraphql.com/docs)
- [WooGraphQL Documentation](https://docs.wpgraphql.com/extensions/wpgraphql-woocommerce)
- [WordPress Codex](https://codex.wordpress.org/)
- [WooCommerce Documentation](https://woocommerce.com/documentation/)
