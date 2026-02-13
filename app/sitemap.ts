import { MetadataRoute } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_PRODUCT_SLUGS, GET_ALL_PRODUCT_CATEGORIES, GET_ALL_BRANDS } from '@/lib/queries/products';
import { GET_ALL_POST_SLUGS, GET_ALL_CATEGORIES, GET_ALL_TAGS } from '@/lib/queries/posts';
import { RequestDocument } from 'graphql-request';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const PAGE_SIZE = 500;
const PRODUCTS_PER_SEGMENT = 5000;
const PRODUCT_SEGMENTS = 7; // Supports up to 35K products

export const revalidate = 86400; // Regenerate daily
export const maxDuration = 60; // Allow up to 60s per segment

/**
 * Generate sitemap segment IDs.
 * Segment 0: static pages, categories, brands, blog
 * Segments 1-N: products (~5K per segment)
 */
export async function generateSitemaps() {
  const ids = [];
  // Segment 0: non-product content
  ids.push({ id: 0 });
  // Segments 1-N: product segments
  for (let i = 1; i <= PRODUCT_SEGMENTS; i++) {
    ids.push({ id: i });
  }
  return ids;
}

/**
 * Fetch all slugs from a paginated WPGraphQL connection.
 */
async function fetchAllSlugs(
  query: RequestDocument,
  rootField: string,
  pageSize = PAGE_SIZE,
): Promise<string[]> {
  const client = getClient();
  const allSlugs: string[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: { data: Record<string, any> } = await client.query({
        query,
        variables: { first: pageSize, after },
      });

      const nodes: { slug: string }[] = result.data?.[rootField]?.nodes || [];
      allSlugs.push(...nodes.map((n) => n.slug));

      hasNextPage = result.data?.[rootField]?.pageInfo?.hasNextPage ?? false;
      after = result.data?.[rootField]?.pageInfo?.endCursor ?? null;
    } catch (error) {
      console.error(`Error fetching ${rootField} slugs for sitemap (after: ${after}):`, error);
      break;
    }
  }

  return allSlugs;
}

/**
 * Fetch a slice of product slugs using cursor-based pagination.
 * Skips `skipItems` products, then fetches up to `maxItems`.
 */
async function fetchProductSlugSegment(
  skipItems: number,
  maxItems: number,
): Promise<string[]> {
  const client = getClient();
  const slugs: string[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  let skipped = 0;

  while (hasNextPage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: { data: Record<string, any> } = await client.query({
        query: GET_ALL_PRODUCT_SLUGS,
        variables: { first: PAGE_SIZE, after },
      });

      const nodes: { slug: string }[] = result.data?.products?.nodes || [];
      hasNextPage = result.data?.products?.pageInfo?.hasNextPage ?? false;
      after = result.data?.products?.pageInfo?.endCursor ?? null;

      for (const node of nodes) {
        if (skipped < skipItems) {
          skipped++;
          continue;
        }
        slugs.push(node.slug);
        if (slugs.length >= maxItems) {
          return slugs;
        }
      }
    } catch (error) {
      console.error(`Error fetching product slugs segment (skip: ${skipItems}, after: ${after}):`, error);
      break;
    }
  }

  return slugs;
}

/**
 * Fetch all nodes from a paginated WPGraphQL connection.
 */
async function fetchAllNodes<T>(
  query: RequestDocument,
  rootField: string,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const client = getClient();
  const allNodes: T[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: { data: Record<string, any> } = await client.query({
        query,
        variables: { first: pageSize, after },
      });

      const nodes: T[] = result.data?.[rootField]?.nodes || [];
      allNodes.push(...nodes);

      hasNextPage = result.data?.[rootField]?.pageInfo?.hasNextPage ?? false;
      after = result.data?.[rootField]?.pageInfo?.endCursor ?? null;
    } catch (error) {
      console.error(`Error fetching ${rootField} for sitemap (after: ${after}):`, error);
      break;
    }
  }

  return allNodes;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
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

    const [categoryNodes, brandNodes, postSlugs, blogCategoryNodes, blogTagNodes] = await Promise.all([
      fetchAllNodes<{ slug: string; count: number }>(GET_ALL_PRODUCT_CATEGORIES, 'productCategories'),
      fetchAllNodes<{ slug: string; count: number }>(GET_ALL_BRANDS, 'productBrands'),
      fetchAllSlugs(GET_ALL_POST_SLUGS, 'posts'),
      fetchAllNodes<{ slug: string; count: number }>(GET_ALL_CATEGORIES, 'categories'),
      fetchAllNodes<{ slug: string; count: number }>(GET_ALL_TAGS, 'tags'),
    ]);

    const categoryPages: MetadataRoute.Sitemap = categoryNodes
      .filter((c) => c.count > 0)
      .map((c) => ({
        url: `${SITE_URL}/sex-toys/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      }));

    const brandPages: MetadataRoute.Sitemap = brandNodes
      .filter((b) => b.count > 0)
      .map((b) => ({
        url: `${SITE_URL}/brand/${b.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.6,
      }));

    const blogPages: MetadataRoute.Sitemap = postSlugs.map((slug) => ({
      url: `${SITE_URL}/guides/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

    const blogCategoryPages: MetadataRoute.Sitemap = blogCategoryNodes
      .filter((c) => c.count > 0)
      .map((c) => ({
        url: `${SITE_URL}/guides/category/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.5,
      }));

    const blogTagPages: MetadataRoute.Sitemap = blogTagNodes
      .filter((t) => t.count > 0)
      .map((t) => ({
        url: `${SITE_URL}/guides/tag/${t.slug}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.4,
      }));

    const allUrls = [...staticPages, ...categoryPages, ...brandPages, ...blogPages, ...blogCategoryPages, ...blogTagPages];
    console.log(`Sitemap segment 0: ${allUrls.length} URLs (categories: ${categoryNodes.length}, brands: ${brandNodes.length}, posts: ${postSlugs.length})`);
    return allUrls;
  }

  // Segments 1+: products (~5K per segment)
  const skipItems = (id - 1) * PRODUCTS_PER_SEGMENT;
  const productSlugs = await fetchProductSlugSegment(skipItems, PRODUCTS_PER_SEGMENT);

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
}
