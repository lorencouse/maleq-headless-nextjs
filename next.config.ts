import type { NextConfig } from "next";

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
        // If using a different domain for WordPress
        protocol: 'https',
        hostname: 'your-wordpress-domain.com',
        port: '',
        pathname: '/wp-content/uploads/**',
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
