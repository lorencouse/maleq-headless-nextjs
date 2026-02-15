import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack configuration (used with `next dev --turbopack`)
  // Turbopack has better defaults for file watching - no need to configure ignored paths
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },

  // Compress responses
  compress: true,

  // Generate ETags for caching
  generateEtags: true,

  // Optimize package imports
  experimental: {
    optimizePackageImports: ['graphql-request', 'zustand', 'react-hot-toast'],
  },

  // Disable ESLint during builds — Next.js's internal ESLint runner passes
  // legacy options (useEslintrc, extensions) incompatible with flat config.
  // Run ESLint separately: npx eslint .
  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    // Disable Vercel image optimization (402 quota exceeded)
    unoptimized: true,
    // Enable image optimization
    formats: ['image/avif', 'image/webp'],
    // Set device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Minimize image quality for smaller file sizes (adjust as needed)
    minimumCacheTTL: 60 * 60 * 24, // 1 day (reduced from 30 to avoid caching failed images too long)
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '159.69.220.162',
        port: '',
        pathname: '/wp-content/uploads/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '',
        pathname: '/wp-content/uploads/**',
      },
      {
        // Local by Flywheel WordPress
        protocol: 'http',
        hostname: 'maleq-local.local',
        port: '',
        pathname: '/wp-content/uploads/**',
      },
      {
        // Local by Flywheel WordPress (alternate hostname)
        protocol: 'http',
        hostname: 'maleq.local',
        port: '',
        pathname: '/wp-content/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'secure.gravatar.com',
        port: '',
      },
      {
        // Staging domain - specific match
        protocol: 'https',
        hostname: 'staging.maleq.com',
        port: '',
        pathname: '/**', // Allow all paths from staging
      },
      {
        // Production domain
        protocol: 'https',
        hostname: 'www.maleq.com',
        port: '',
        pathname: '/**',
      },
      {
        // Base domain
        protocol: 'https',
        hostname: 'maleq.com',
        port: '',
        pathname: '/**',
      },
      {
        // V2 WordPress backend (headless API + images)
        protocol: 'https',
        hostname: 'wp.maleq.com',
        port: '',
        pathname: '/**',
      },
      {
        // Production WordPress domain (where images are actually hosted)
        protocol: 'https',
        hostname: 'www.maleq.org',
        port: '',
        pathname: '/**',
      },
      {
        // Williams Trading image server
        protocol: 'http',
        hostname: 'images.williams-trading.com',
        port: '',
        pathname: '/**',
      },
    ],
  },

  // Redirect old V1 WordPress URLs to V2 equivalents
  async redirects() {
    return [
      // --- WooCommerce / Account routes ---
      {
        // Strip pagination from old category URLs before redirect
        // /product-category/dildos/page/2/ → /sex-toys/dildos
        source: '/product-category/:slug/page/:num(\\d+)',
        destination: '/sex-toys/:slug',
        permanent: true,
      },
      {
        source: '/product-category/:slug*',
        destination: '/sex-toys/:slug*',
        permanent: true,
      },
      {
        // Old WooCommerce product tag URLs
        source: '/product-tag/:slug*',
        destination: '/sex-toys',
        permanent: true,
      },
      {
        source: '/my-account/:path*',
        destination: '/account/:path*',
        permanent: true,
      },
      {
        source: '/my-account',
        destination: '/account',
        permanent: true,
      },
      {
        source: '/returns',
        destination: '/shipping-returns',
        permanent: true,
      },

      // --- Blog taxonomy routes ---
      {
        source: '/category/:slug*',
        destination: '/guides/category/:slug*',
        permanent: true,
      },
      {
        source: '/tag/:slug*',
        destination: '/guides/tag/:slug*',
        permanent: true,
      },

      // --- WordPress infrastructure routes ---
      {
        source: '/wp-login.php',
        destination: '/login',
        permanent: true,
      },
      {
        source: '/wp-admin/:path*',
        destination: '/',
        permanent: false, // 302 — not a permanent content move
      },
      {
        source: '/wp-admin',
        destination: '/',
        permanent: false,
      },

      // --- Author archives → guides index ---
      {
        source: '/author/:slug*',
        destination: '/guides',
        permanent: true,
      },

      // --- Feed URLs → homepage ---
      {
        source: '/feed/:path*',
        destination: '/',
        permanent: true,
      },
      {
        source: '/feed',
        destination: '/',
        permanent: true,
      },
      {
        source: '/comments/feed/:path*',
        destination: '/',
        permanent: true,
      },

      // --- WordPress pagination → strip /page/N/ ---
      {
        source: '/page/:num(\\d+)',
        destination: '/guides',
        permanent: true,
      },
      {
        // Category pagination: /sex-toys/dildos/page/2 → /sex-toys/dildos
        source: '/sex-toys/:slug/page/:num(\\d+)',
        destination: '/sex-toys/:slug',
        permanent: true,
      },
      {
        // Blog pagination: /guides/page/2 → /guides
        source: '/guides/page/:num(\\d+)',
        destination: '/guides',
        permanent: true,
      },
      {
        // Blog category pagination
        source: '/guides/category/:slug/page/:num(\\d+)',
        destination: '/guides/category/:slug',
        permanent: true,
      },
      {
        // Blog tag pagination
        source: '/guides/tag/:slug/page/:num(\\d+)',
        destination: '/guides/tag/:slug',
        permanent: true,
      },
      {
        // Brand pagination
        source: '/brand/:slug/page/:num(\\d+)',
        destination: '/brand/:slug',
        permanent: true,
      },

      // --- Date-based archive URLs → /guides/:slug ---
      // Matches /2024/01/post-slug/ style WordPress permalinks
      {
        source: '/:year(\\d{4})/:month(\\d{2})/:slug',
        destination: '/guides/:slug',
        permanent: true,
      },
      {
        source: '/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})/:slug',
        destination: '/guides/:slug',
        permanent: true,
      },

      // --- Old nested WordPress paths (from migration scripts) ---
      {
        source: '/stories/:slug*',
        destination: '/guides/:slug*',
        permanent: true,
      },
      {
        source: '/manufacturer/:slug',
        destination: '/brand/:slug',
        permanent: true,
      },
      {
        source: '/members/:path*',
        destination: '/',
        permanent: true,
      },

      // --- WordPress artifact URLs ---
      {
        // Strip .html extensions from old URLs
        source: '/:path*.html',
        destination: '/:path*',
        permanent: true,
      },
      {
        // Old WordPress attachment pages
        source: '/attachment/:slug*',
        destination: '/',
        permanent: true,
      },
      {
        // /shop/page/N → /shop
        source: '/shop/page/:num(\\d+)',
        destination: '/shop',
        permanent: true,
      },

      // --- Catch-all: old root-level blog post URLs → /guides/:slug ---
      // Old WordPress had posts at /:slug, new site uses /guides/:slug
      // Regex matches URL-safe slugs (letters, numbers, hyphens) but excludes known app routes
      // Supports single-char slugs and is case-insensitive via [a-zA-Z0-9]
      {
        source:
          '/:slug((?!account|forgot-password|reset-password|search|login|register|about|contact|faq|terms|privacy|shipping-returns|brands|brand|shop|guides|cart|checkout|product|sex-toys|order-confirmation|track-order|admin|api|graphql|_next|images|fonts|wp-)[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)',
        destination: '/guides/:slug',
        permanent: true,
      },
    ];
  },

  // Rewrite GraphQL endpoint if needed
  async rewrites() {
    return [
      {
        source: '/graphql',
        destination: `${process.env.NEXT_PUBLIC_WORDPRESS_API_URL}`,
      },
    ];
  },

  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Add caching headers
  async headers() {
    return [
      {
        // Cache static assets for 1 year
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Cache fonts for 1 year
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Security headers for all pages
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.stripe.com https://www.google-analytics.com https://*.maleq.com https://*.maleq.org https://www.googletagmanager.com",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
