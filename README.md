# Maleq Headless WordPress & WooCommerce

A modern, high-performance e-commerce and blog platform built with Next.js 16 and headless WordPress/WooCommerce.

## Tech Stack

### Frontend
- **Next.js 16** with App Router and React Server Components
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Apollo Client** for GraphQL data fetching

### Backend (WordPress on Hetzner: 159.69.220.162)
- **WordPress 6.4+** as headless CMS
- **WooCommerce 8.0+** for e-commerce
- **MySQL 8.0** database
- **WPGraphQL** for GraphQL API
- **WooGraphQL** for WooCommerce GraphQL support

## Features

- ✅ Server-side rendering (SSR) and static generation (SSG)
- ✅ Incremental Static Regeneration (ISR) for optimal performance
- ✅ SEO-optimized with meta tags and structured data
- ✅ Real-time inventory updates
- ✅ Advanced product filtering and search
- ✅ Blog with categories, tags, and comments
- ✅ Image optimization with Next.js Image component
- ✅ Responsive design with Tailwind CSS
- ✅ Type-safe GraphQL queries

## Project Structure

```
maleq-headless/
├── app/
│   ├── blog/
│   │   ├── [slug]/page.tsx       # Individual blog post
│   │   └── page.tsx              # Blog listing
│   ├── shop/
│   │   ├── product/[slug]/page.tsx  # Individual product
│   │   └── page.tsx              # Shop listing
│   ├── api/revalidate/route.ts   # Cache revalidation webhook
│   └── layout.tsx                # Root layout
├── components/
│   ├── blog/BlogCard.tsx
│   ├── shop/ProductCard.tsx
│   └── layout/Header.tsx, Footer.tsx
├── lib/
│   ├── apollo/client.ts          # Apollo Client config
│   ├── queries/posts.ts, products.ts
│   └── types/wordpress.ts, woocommerce.ts
└── next.config.ts
```

## Prerequisites

**WordPress Setup on Hetzner (159.69.220.162):**
- WordPress 6.4+ installed
- WooCommerce 8.0+ installed
- MySQL 8.0 database

**Required WordPress Plugins:**
- WPGraphQL (https://www.wpgraphql.com/)
- WooGraphQL (https://github.com/wp-graphql/wp-graphql-woocommerce)
- WPGraphQL for ACF (optional, for custom fields)
- JWT Authentication for WP-API (for authenticated requests)

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and update:

```env
NEXT_PUBLIC_WORDPRESS_API_URL=https://159.69.220.162/graphql
NEXT_PUBLIC_SITE_URL=http://localhost:3000
REVALIDATION_SECRET=your_secure_random_string
```

### 3. WordPress Plugin Setup

**Install WPGraphQL:**
```bash
ssh root@159.69.220.162
cd /path/to/wordpress/wp-content/plugins
wget https://downloads.wordpress.org/plugin/wp-graphql.latest-stable.zip
unzip wp-graphql.latest-stable.zip
wp plugin activate wp-graphql
```

**Install WooGraphQL:**
```bash
git clone https://github.com/wp-graphql/wp-graphql-woocommerce.git
cd wp-graphql-woocommerce
composer install --no-dev
wp plugin activate wp-graphql-woocommerce
```

### 4. Configure WordPress for Headless

In WordPress admin:
1. **Settings > General** - Set URLs
2. **GraphQL > Settings** - Enable public introspection
3. **WooCommerce > Settings** - Enable REST API

### 5. Set Up Webhooks (Cache Revalidation)

Install WP Webhooks plugin and configure:

**Post Updated:**
```
URL: https://your-site.com/api/revalidate?secret=your_secret
Body: {"type": "post", "slug": "{post_name}"}
```

**Product Updated:**
```
URL: https://your-site.com/api/revalidate?secret=your_secret
Body: {"type": "product", "slug": "{post_name}"}
```

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Production Build

```bash
npm run build
npm start
```

## Deployment

### Option 1: Hetzner (Same Server)

```bash
npm run build
pm2 start npm --name "maleq-frontend" -- start
pm2 save
```

Configure Nginx:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

### Option 2: Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy

## WordPress Content Migration

**Blog Posts:**
- Old site: Tools > Export > Posts
- New site: Tools > Import > WordPress

**Products:**
- Old site: WooCommerce > Products > Export
- New site: WooCommerce > Products > Import

## Performance Optimization

**Caching Strategy:**
- Blog posts: 1 hour (3600s)
- Products: 5 minutes (300s) for inventory
- Listings: 30 minutes (1800s)

**Database Optimization:**
```sql
ALTER TABLE wp_posts ADD INDEX idx_post_status_type (post_status, post_type);
ALTER TABLE wp_postmeta ADD INDEX idx_meta_key_value (meta_key(191), meta_value(191));
```

## GraphQL Examples

**Fetch Posts:**
```graphql
query {
  posts(first: 10) {
    nodes {
      title
      slug
      excerpt
    }
  }
}
```

**Fetch Products:**
```graphql
query {
  products(first: 12) {
    nodes {
      name
      price
      image { sourceUrl }
    }
  }
}
```

## Troubleshooting

**GraphQL not accessible:**
- Activate WPGraphQL plugin
- Set permalinks to "Post name"
- Check .htaccess rewrite rules

**Images not loading:**
- Update `next.config.ts` image domains
- Check WordPress media permissions
- Configure CORS on WordPress

**Build fails:**
- Use Node.js 18+
- Clear cache: `rm -rf .next`
- Verify environment variables

## Security

- Use HTTPS for WordPress
- Rate limit GraphQL endpoint
- Sanitize user input
- Use JWT for auth
- Keep plugins updated

## Next Steps

- [ ] Cart functionality
- [ ] User authentication
- [ ] Checkout flow
- [ ] Product reviews
- [ ] Search (Algolia/ElasticSearch)
- [ ] Newsletter subscription
- [ ] Analytics
- [ ] Sitemap & structured data

## Documentation

- [Next.js Docs](https://nextjs.org/docs)
- [WPGraphQL Docs](https://www.wpgraphql.com/docs)
- [WooGraphQL](https://github.com/wp-graphql/wp-graphql-woocommerce)

## License

MIT
