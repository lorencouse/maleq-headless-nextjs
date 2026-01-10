# Quick Start Guide

## What's Been Set Up

Your headless WordPress/WooCommerce frontend is now ready! Here's what we've built:

### Project Structure ✅
- Next.js 16 with App Router and TypeScript
- Tailwind CSS for styling
- Apollo Client for GraphQL
- Complete folder structure with components, queries, and types

### Pages Created ✅
1. **Homepage** ([app/page.tsx](app/page.tsx)) - Hero, featured products, latest posts
2. **Blog Listing** ([app/blog/page.tsx](app/blog/page.tsx)) - All blog posts
3. **Blog Post** ([app/blog/[slug]/page.tsx](app/blog/[slug]/page.tsx)) - Individual posts with comments
4. **Shop Listing** ([app/shop/page.tsx](app/shop/page.tsx)) - All products
5. **Product Page** ([app/shop/product/[slug]/page.tsx](app/shop/product/[slug]/page.tsx)) - Product details

### Components Created ✅
- Header with navigation
- Footer with links
- BlogCard for post previews
- ProductCard for product displays

### GraphQL Queries ✅
- Blog posts (all, by slug, by category)
- Products (all, by slug, search, filter)
- Optimized for performance

### Configuration ✅
- Environment variables setup
- Next.js image optimization
- ISR (Incremental Static Regeneration)
- Webhook endpoint for cache revalidation

## Next Steps

### 1. Configure WordPress Backend

Follow the detailed guide in [WORDPRESS_SETUP.md](WORDPRESS_SETUP.md):

```bash
# SSH into your Hetzner server
ssh root@159.69.220.162

# Install required plugins:
# - WPGraphQL
# - WooGraphQL (WPGraphQL for WooCommerce)
# - WP Webhooks (optional, for cache revalidation)
```

### 2. Update Environment Variables

Edit [.env.local](.env.local):

```env
NEXT_PUBLIC_WORDPRESS_API_URL=https://159.69.220.162/graphql
NEXT_PUBLIC_SITE_URL=http://localhost:3000
REVALIDATION_SECRET=generate_a_secure_random_string_here
```

### 3. Update Image Domains

Edit [next.config.ts](next.config.ts:8-11) to match your WordPress domain.

### 4. Start Development Server

```bash
npm run dev
```

Open http://localhost:3000

### 5. Migrate Content

See [WORDPRESS_SETUP.md](WORDPRESS_SETUP.md) section "Content Migration" for:
- Exporting blog posts from old WordPress
- Exporting WooCommerce products
- Importing to new WordPress instance

## Testing the Setup

### Test WordPress GraphQL Endpoint

```bash
curl -X POST https://159.69.220.162/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ posts { nodes { title } } }"}'
```

### Test Next.js Pages

1. Homepage: http://localhost:3000
2. Blog: http://localhost:3000/blog
3. Shop: http://localhost:3000/shop

## Common Issues

### "No products/posts available"
- WordPress plugins not installed/activated
- GraphQL endpoint not accessible
- CORS issues (add headers to WordPress)

### Images not loading
- Update `next.config.ts` with correct image domains
- Check WordPress media permissions

### Build errors
- Ensure Node.js 18+
- Clear cache: `rm -rf .next`
- Run `npm install` again

## File Reference

### Key Files to Know
- [app/layout.tsx](app/layout.tsx:1) - Root layout with Header/Footer
- [lib/apollo/client.ts](lib/apollo/client.ts:1) - GraphQL client setup
- [lib/queries/posts.ts](lib/queries/posts.ts:1) - Blog GraphQL queries
- [lib/queries/products.ts](lib/queries/products.ts:1) - Product GraphQL queries
- [components/blog/BlogCard.tsx](components/blog/BlogCard.tsx:1) - Blog post card
- [components/shop/ProductCard.tsx](components/shop/ProductCard.tsx:1) - Product card

### Documentation
- [README.md](README.md) - Complete project documentation
- [WORDPRESS_SETUP.md](WORDPRESS_SETUP.md) - WordPress configuration guide
- This file - Quick start reference

## Tech Stack Summary

**Frontend:**
- Next.js 16 (App Router, React Server Components)
- TypeScript
- Tailwind CSS
- Apollo Client

**Backend (on 159.69.220.162):**
- WordPress 6.4+ (Headless CMS)
- WooCommerce 8.0+ (E-commerce)
- MySQL 8.0 (Database)
- WPGraphQL (GraphQL API)

**Features:**
- SSR/SSG for SEO
- ISR for performance
- Real-time inventory (5-min cache)
- Image optimization
- Type-safe queries

## Development Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Type checking
npm run lint
```

## Deployment

Choose your deployment option:

### Option 1: Hetzner (Cost-effective)
Both WordPress and Next.js on same server

### Option 2: Vercel (Best Performance)
WordPress on Hetzner, Next.js on Vercel

See [README.md](README.md) for detailed deployment instructions.

## Need Help?

Refer to:
- [README.md](README.md) - Full documentation
- [WORDPRESS_SETUP.md](WORDPRESS_SETUP.md) - WordPress guide
- Next.js Docs: https://nextjs.org/docs
- WPGraphQL Docs: https://www.wpgraphql.com/docs

## What's Next?

After basic setup works:
- [ ] Implement shopping cart
- [ ] Add user authentication
- [ ] Build checkout flow
- [ ] Set up payment gateway
- [ ] Add product search
- [ ] Configure analytics
- [ ] Set up automated backups
- [ ] Implement SEO optimizations

Good luck with your headless WordPress project!
