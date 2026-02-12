import { MetadataRoute } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_PRODUCT_SLUGS, GET_ALL_PRODUCT_CATEGORIES, GET_ALL_BRANDS } from '@/lib/queries/products';
import { GET_ALL_POST_SLUGS, GET_ALL_CATEGORIES, GET_ALL_TAGS } from '@/lib/queries/posts';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const client = getClient();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/shop`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/guides`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/brands`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/faq`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/shipping-returns`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/register`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  // Fetch all product slugs
  let productPages: MetadataRoute.Sitemap = [];
  try {
    const { data: productData } = await client.query({
      query: GET_ALL_PRODUCT_SLUGS,
    });

    productPages = (productData?.products?.nodes || []).map((product: { slug: string }) => ({
      url: `${SITE_URL}/product/${product.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch (error) {
    console.error('Error fetching product slugs for sitemap:', error);
  }

  // Fetch all category slugs
  let categoryPages: MetadataRoute.Sitemap = [];
  try {
    const { data: categoryData } = await client.query({
      query: GET_ALL_PRODUCT_CATEGORIES,
    });

    categoryPages = (categoryData?.productCategories?.nodes || [])
      .filter((category: { count: number }) => category.count > 0)
      .map((category: { slug: string }) => ({
        url: `${SITE_URL}/sex-toys/${category.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
  } catch (error) {
    console.error('Error fetching category slugs for sitemap:', error);
  }

  // Fetch all brand slugs
  let brandPages: MetadataRoute.Sitemap = [];
  try {
    const { data: brandData } = await client.query({
      query: GET_ALL_BRANDS,
    });

    brandPages = (brandData?.productBrands?.nodes || [])
      .filter((brand: { count: number }) => brand.count > 0)
      .map((brand: { slug: string }) => ({
        url: `${SITE_URL}/brand/${brand.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }));
  } catch (error) {
    console.error('Error fetching brand slugs for sitemap:', error);
  }

  // Fetch all blog post slugs
  let blogPages: MetadataRoute.Sitemap = [];
  try {
    const { data: postData } = await client.query({
      query: GET_ALL_POST_SLUGS,
    });

    blogPages = (postData?.posts?.nodes || []).map((post: { slug: string }) => ({
      url: `${SITE_URL}/guides/${post.slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  } catch (error) {
    console.error('Error fetching post slugs for sitemap:', error);
  }

  // Fetch all blog category slugs
  let blogCategoryPages: MetadataRoute.Sitemap = [];
  try {
    const { data: categoryData } = await client.query({
      query: GET_ALL_CATEGORIES,
    });

    blogCategoryPages = (categoryData?.categories?.nodes || [])
      .filter((cat: { count: number }) => cat.count > 0)
      .map((cat: { slug: string }) => ({
        url: `${SITE_URL}/guides/category/${cat.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
  } catch (error) {
    console.error('Error fetching blog category slugs for sitemap:', error);
  }

  // Fetch all blog tag slugs
  let blogTagPages: MetadataRoute.Sitemap = [];
  try {
    const { data: tagData } = await client.query({
      query: GET_ALL_TAGS,
    });

    blogTagPages = (tagData?.tags?.nodes || [])
      .filter((tag: { count: number }) => tag.count > 0)
      .map((tag: { slug: string }) => ({
        url: `${SITE_URL}/guides/tag/${tag.slug}`,
        lastModified: new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      }));
  } catch (error) {
    console.error('Error fetching blog tag slugs for sitemap:', error);
  }

  return [
    ...staticPages,
    ...productPages,
    ...categoryPages,
    ...brandPages,
    ...blogPages,
    ...blogCategoryPages,
    ...blogTagPages,
  ];
}
