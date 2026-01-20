import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Exclude data directory from webpack watching (image imports trigger recompiles)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/data/**', '**/.git/**'],
      };
    }
    return config;
  },

  // Compress responses
  compress: true,

  // Generate ETags for caching
  generateEtags: true,

  // Optimize package imports
  experimental: {
    optimizePackageImports: ['@apollo/client', 'zustand', 'react-hot-toast'],
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
        ],
      },
    ];
  },
};

export default nextConfig;
