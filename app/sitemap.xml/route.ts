import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const PRODUCT_SEGMENTS = 7;

export const revalidate = 86400;

export async function GET() {
  const sitemapUrls: string[] = [];

  // Segment 0: static pages, categories, brands, blog
  sitemapUrls.push(`${SITE_URL}/sitemap/0.xml`);

  // Segments 1-N: products
  for (let i = 1; i <= PRODUCT_SEGMENTS; i++) {
    sitemapUrls.push(`${SITE_URL}/sitemap/${i}.xml`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <sitemap>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
