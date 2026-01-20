import { MetadataRoute } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_PRODUCT_SLUGS, GET_ALL_PRODUCT_CATEGORIES } from '@/lib/queries/products';

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
      url: `${SITE_URL}/shop/product/${product.slug}`,
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
        url: `${SITE_URL}/shop/category/${category.slug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
  } catch (error) {
    console.error('Error fetching category slugs for sitemap:', error);
  }

  return [...staticPages, ...productPages, ...categoryPages];
}
