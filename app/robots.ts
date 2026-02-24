import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/api',
          '/account/',
          '/account',
          '/checkout/',
          '/checkout',
          '/cart/',
          '/cart',
          '/order-confirmation/',
          '/order-confirmation',
          '/admin/',
          '/admin',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
