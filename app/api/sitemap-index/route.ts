import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const PRODUCTS_PER_SEGMENT = 5000;

export const revalidate = 86400; // Cache for 24h

/**
 * Dynamic sitemap index that lists all sitemap segments.
 * Served at /sitemap.xml via a beforeFiles rewrite in next.config.ts.
 */
export async function GET() {
  let segmentCount = 1; // segment 0 is always static pages

  try {
    const { getAllIndexEntries } = await import('@/lib/products/product-index');
    const entries = await getAllIndexEntries();
    const productSegments = Math.ceil(entries.length / PRODUCTS_PER_SEGMENT);
    segmentCount = 1 + productSegments;
  } catch {
    // MySQL unavailable — return estimated segments based on ~35k products
    segmentCount = 9;
  }

  const sitemaps = Array.from({ length: segmentCount }, (_, i) =>
    `  <sitemap>\n    <loc>${SITE_URL}/sitemap/${i}.xml</loc>\n  </sitemap>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
    },
  });
}
