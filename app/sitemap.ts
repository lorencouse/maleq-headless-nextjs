import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const PRODUCTS_PER_SEGMENT = 5000;

export const revalidate = 86400; // Cache for 24h, regenerate on request
export const maxDuration = 120; // Allow up to 120s per segment

/**
 * Generate sitemap segment IDs.
 * Segment 0: static pages, categories, brands, blog
 * Segments 1-N: products (~5K per segment, computed from actual product count)
 *
 * At build time MySQL may not be available — returns a minimal set (segment 0 only).
 * At runtime (ISR revalidation), MySQL is available and the full set is computed.
 */
export async function generateSitemaps() {
  try {
    const { getAllIndexEntries } = await import('@/lib/products/product-index');
    const entries = await getAllIndexEntries();
    const productSegments = Math.ceil(entries.length / PRODUCTS_PER_SEGMENT);

    const ids = [];
    ids.push({ id: 0 });
    for (let i = 1; i <= productSegments; i++) {
      ids.push({ id: i });
    }
    return ids;
  } catch (err) {
    // Build time: MySQL not available — return estimated segments (~35k products / 5k per segment).
    // This ensures Next.js generates all sitemap routes at build time.
    // At runtime, ISR will regenerate each segment with real data.
    console.warn('[sitemap] MySQL unavailable at build time, using estimated segments:', err instanceof Error ? err.message : err);
    return Array.from({ length: 9 }, (_, i) => ({ id: i }));
  }
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);

  // Segment 0: static pages + categories + brands + blog
  if (id === 0) {
    const staticPages: MetadataRoute.Sitemap = [
      { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
      { url: `${SITE_URL}/shop`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
      { url: `${SITE_URL}/guides`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
      { url: `${SITE_URL}/brands`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
      { url: `${SITE_URL}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
      { url: `${SITE_URL}/contact`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
      { url: `${SITE_URL}/faq`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
      { url: `${SITE_URL}/shipping-returns`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
      { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
      { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    ];

    // At build time MySQL may not be available — return just static pages
    try {
      const { loadFlatCategories } = await import('@/lib/db/category-loader');
      const { loadBrands } = await import('@/lib/db/taxonomy-loader');
      const { loadGuideSitemapEntries } = await import('@/lib/db/guide-sitemap');
      const { loadBlogCategories, loadBlogTags } = await import('@/lib/db/blog-loader');

      const [categories, brands, guideEntries, blogCategories, blogTags] = await Promise.all([
        loadFlatCategories(),
        loadBrands(),
        loadGuideSitemapEntries(SITE_URL),
        loadBlogCategories(),
        loadBlogTags(),
      ]);

      const categoryPages: MetadataRoute.Sitemap = categories
        .filter((c) => (c.count ?? 0) > 0)
        .map((c) => ({
          url: `${SITE_URL}/sex-toys/${c.slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.7,
        }));

      const brandPages: MetadataRoute.Sitemap = brands
        .filter((b) => b.count > 0)
        .map((b) => ({
          url: `${SITE_URL}/brand/${b.slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.6,
        }));

      const blogPages: MetadataRoute.Sitemap = guideEntries.map((entry) => ({
        url: `${SITE_URL}/guides/${entry.slug}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
        ...(entry.languages ? { alternates: { languages: entry.languages } } : {}),
      }));

      const blogCategoryPages: MetadataRoute.Sitemap = blogCategories
        .filter((c) => c.count > 0)
        .map((c) => ({
          url: `${SITE_URL}/guides/category/${c.slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.5,
        }));

      const blogTagPages: MetadataRoute.Sitemap = blogTags
        .filter((t) => t.count > 0)
        .map((t) => ({
          url: `${SITE_URL}/guides/tag/${t.slug}`,
          lastModified: new Date(),
          changeFrequency: 'monthly',
          priority: 0.4,
        }));

      const allUrls = [...staticPages, ...categoryPages, ...brandPages, ...blogPages, ...blogCategoryPages, ...blogTagPages];
      console.log(`Sitemap segment 0: ${allUrls.length} URLs (categories: ${categories.length}, brands: ${brands.length}, posts: ${guideEntries.length})`);
      return allUrls;
    } catch (err) {
      console.warn('[sitemap] MySQL unavailable, returning static pages only:', err instanceof Error ? err.message : err);
      return staticPages;
    }
  }

  // Segments 1+: products (~5K per segment)
  try {
    const { getAllIndexEntries } = await import('@/lib/products/product-index');
    const allEntries = await getAllIndexEntries();
    const skipItems = (id - 1) * PRODUCTS_PER_SEGMENT;
    const productSlugs = allEntries
      .slice(skipItems, skipItems + PRODUCTS_PER_SEGMENT)
      .map(e => e.slug);

    if (productSlugs.length === 0) {
      return [];
    }

    const productPages: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
      url: `${SITE_URL}/product/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

    console.log(`Sitemap segment ${id}: ${productPages.length} product URLs (skip: ${skipItems})`);
    return productPages;
  } catch (err) {
    console.warn(`[sitemap] MySQL unavailable for segment ${id}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
