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

  images: {
    // Enable image optimization
    formats: ['image/avif', 'image/webp'],
    // Set device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Minimize image quality for smaller file sizes (adjust as needed)
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
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

  // Redirect old /product-category/ URLs to /sex-toys/
  async redirects() {
    return [
      {
        source: '/product-category/:slug*',
        destination: '/sex-toys/:slug*',
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
