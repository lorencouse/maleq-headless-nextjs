import { MetadataRoute } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_PRODUCT_SLUGS, GET_ALL_PRODUCT_CATEGORIES, GET_ALL_BRANDS } from '@/lib/queries/products';
import { GET_ALL_POST_SLUGS, GET_ALL_CATEGORIES, GET_ALL_TAGS } from '@/lib/queries/posts';
import { RequestDocument } from 'graphql-request';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const PAGE_SIZE = 500;

/**
 * Fetch all slugs from a paginated WPGraphQL connection.
 * Loops through pages using cursor-based pagination until all results are fetched.
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
 * Fetch all nodes from a paginated WPGraphQL connection.
 * Returns full node objects (with slug and count) for filtering.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
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

  // Fetch all content types in parallel
  const [
    productSlugs,
    categoryNodes,
    brandNodes,
    postSlugs,
    blogCategoryNodes,
    blogTagNodes,
  ] = await Promise.all([
    fetchAllSlugs(GET_ALL_PRODUCT_SLUGS, 'products'),
    fetchAllNodes<{ slug: string; count: number }>(GET_ALL_PRODUCT_CATEGORIES, 'productCategories'),
    fetchAllNodes<{ slug: string; count: number }>(GET_ALL_BRANDS, 'productBrands'),
    fetchAllSlugs(GET_ALL_POST_SLUGS, 'posts'),
    fetchAllNodes<{ slug: string; count: number }>(GET_ALL_CATEGORIES, 'categories'),
    fetchAllNodes<{ slug: string; count: number }>(GET_ALL_TAGS, 'tags'),
  ]);

  const productPages: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
    url: `${SITE_URL}/product/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

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

  const allUrls = [
    ...staticPages,
    ...productPages,
    ...categoryPages,
    ...brandPages,
    ...blogPages,
    ...blogCategoryPages,
    ...blogTagPages,
  ];

  console.log(`Sitemap generated: ${allUrls.length} URLs (${productSlugs.length} products, ${categoryNodes.length} categories, ${brandNodes.length} brands, ${postSlugs.length} posts, ${blogCategoryNodes.length} blog categories, ${blogTagNodes.length} blog tags)`);

  return allUrls;
}
