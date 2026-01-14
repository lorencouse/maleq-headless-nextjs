import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
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
};

export default nextConfig;
