# Setting Up a Staging Environment for maleq.com

This guide will help you create a staging subdomain (staging.maleq.com) that mirrors your production WordPress setup safely.

## Overview

**Production:** maleq.com → Live site with real traffic and sales
**Staging:** staging.maleq.com → Safe copy for development and testing

---

## Step 1: Choose Your Staging Subdomain

Pick one of these options:
- `staging.maleq.com` (recommended)
- `dev.maleq.com`
- `test.maleq.com`

For this guide, we'll use **staging.maleq.com**

---

## Step 2: Set Up DNS

Add a DNS A record for your staging subdomain:

### If using Cloudflare, Namecheap, GoDaddy, etc.:

1. Log into your DNS provider
2. Go to DNS management for maleq.com
3. Add a new **A Record**:
   - **Type:** A
   - **Name:** staging (or dev/test)
   - **Value/Points to:** 159.69.220.162
   - **TTL:** Auto or 3600

4. Save the record
5. Wait 5-15 minutes for DNS propagation

### Verify DNS is working:

```bash
# Test if DNS is resolving
dig staging.maleq.com
# OR
nslookup staging.maleq.com
```

You should see it pointing to 159.69.220.162

---

## Step 3: Configure Web Server (Apache/Nginx)

You need to configure your web server on 159.69.220.162 to handle the staging subdomain.

### Option A: If you're using a hosting control panel (cPanel, Plesk, etc.)

1. Log into your control panel
2. Go to "Domains" or "Subdomains"
3. Add new subdomain: `staging.maleq.com`
4. Point it to a new directory (e.g., `/var/www/staging.maleq.com`)
5. Enable SSL (Let's Encrypt) for the subdomain

### Option B: If managing server directly (Apache)

SSH into your server and create a new virtual host:

```bash
# Create directory for staging site
sudo mkdir -p /var/www/staging.maleq.com/public_html

# Create Apache virtual host config
sudo nano /etc/apache2/sites-available/staging.maleq.com.conf
```

Add this configuration:

```apache
<VirtualHost *:80>
    ServerName staging.maleq.com
    ServerAlias www.staging.maleq.com
    DocumentRoot /var/www/staging.maleq.com/public_html

    <Directory /var/www/staging.maleq.com/public_html>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/staging.maleq.com-error.log
    CustomLog ${APACHE_LOG_DIR}/staging.maleq.com-access.log combined
</VirtualHost>
```

Enable the site and reload Apache:

```bash
sudo a2ensite staging.maleq.com.conf
sudo systemctl reload apache2
```

### Option C: If using Nginx

```bash
# Create directory
sudo mkdir -p /var/www/staging.maleq.com

# Create Nginx config
sudo nano /etc/nginx/sites-available/staging.maleq.com
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name staging.maleq.com www.staging.maleq.com;
    root /var/www/staging.maleq.com;
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/staging.maleq.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 4: Install SSL Certificate

Use Let's Encrypt for free SSL:

```bash
sudo certbot --apache -d staging.maleq.com
# OR for Nginx:
sudo certbot --nginx -d staging.maleq.com
```

Follow the prompts to install the certificate.

---

## Step 5: Set Up WordPress on Staging

### Option A: Clone from Production (Recommended)

Use a WordPress migration plugin:
1. Install **Duplicator** or **All-in-One WP Migration** on maleq.com
2. Create a backup/package
3. Download it
4. Install WordPress on staging.maleq.com
5. Upload and restore the backup

### Option B: Fresh WordPress Install

1. Download WordPress:
```bash
cd /var/www/staging.maleq.com/public_html
wget https://wordpress.org/latest.tar.gz
tar -xzvf latest.tar.gz
mv wordpress/* .
rmdir wordpress
rm latest.tar.gz
```

2. Create a database:
```bash
mysql -u root -p
CREATE DATABASE staging_maleq;
CREATE USER 'staging_user'@'localhost' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON staging_maleq.* TO 'staging_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

3. Configure wp-config.php:
```bash
cp wp-config-sample.php wp-config.php
nano wp-config.php
```

Update database credentials.

4. Visit https://staging.maleq.com/wp-admin/install.php and complete setup

---

## Step 6: Install Required WordPress Plugins

Install these on your staging WordPress:

1. **WPGraphQL** (required)
   - Go to Plugins → Add New → Search "WPGraphQL"
   - Install and activate

2. **WPGraphQL for WooCommerce** (if using WooCommerce)
   - Download from: https://github.com/wp-graphql/wp-graphql-woocommerce
   - Upload and activate

3. Verify GraphQL is working:
   - Visit: https://staging.maleq.com/graphql
   - You should see the GraphiQL interface

---

## Step 7: Update Your Next.js Configuration

Once staging is ready, update your local `.env.local`:

```env
NEXT_PUBLIC_WORDPRESS_API_URL=https://staging.maleq.com/graphql
```

Update `next.config.ts` to allow images from staging:

```typescript
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'staging.maleq.com',
      pathname: '/wp-content/uploads/**',
    },
  ],
},
```

---

## Step 8: Test Everything

1. Restart your Next.js dev server:
```bash
bun dev
```

2. Visit http://localhost:3000
3. Verify data is loading from staging

---

## Best Practices

### Prevent Staging from Being Indexed by Search Engines

Add to staging WordPress (Settings → Reading):
- ☑ Discourage search engines from indexing this site

Or add to `.htaccess`:
```apache
Header set X-Robots-Tag "noindex, nofollow"
```

### Password Protect Staging (Optional)

Add basic auth to your staging subdomain:

```bash
sudo htpasswd -c /etc/apache2/.htpasswd staging_user
```

Add to Apache config:
```apache
<Directory /var/www/staging.maleq.com/public_html>
    AuthType Basic
    AuthName "Staging Access"
    AuthUserFile /etc/apache2/.htpasswd
    Require valid-user
</Directory>
```

### Keep Staging in Sync

Periodically sync production data to staging:
- Use Duplicator or WP Migrate DB
- Or set up automated database syncs
- Remember: staging → production (never the reverse!)

---

## Quick Reference

| Environment | URL | Purpose |
|-------------|-----|---------|
| Production | https://maleq.com | Live site with real traffic |
| Staging | https://staging.maleq.com | Safe testing environment |
| Local Dev | http://localhost:3000 | Your Next.js development server |

---

## Troubleshooting

### DNS not resolving?
- Wait 15-30 minutes for propagation
- Clear your DNS cache: `sudo dscacheutil -flushcache` (Mac)

### SSL certificate issues?
- Make sure DNS is fully propagated before running certbot
- Check firewall allows ports 80 and 443

### GraphQL not working?
- Verify WPGraphQL plugin is activated
- Check permalink settings (Settings → Permalinks → Save)
- Visit /graphql directly to test

### 403 Forbidden errors?
- Check file permissions: `sudo chown -R www-data:www-data /var/www/staging.maleq.com`
- Set correct permissions: `sudo find /var/www/staging.maleq.com -type d -exec chmod 755 {} \;`

---

## Need Help?

If you run into issues:
1. Check your server's error logs (`/var/log/apache2/error.log` or `/var/log/nginx/error.log`)
2. Verify DNS with `dig staging.maleq.com`
3. Test GraphQL endpoint directly in browser
4. Check WordPress admin for plugin errors
