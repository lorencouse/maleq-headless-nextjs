import { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import { stripHtml } from '@/lib/utils/text-utils';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { BreadcrumbSchema } from '@/components/seo/StructuredData';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';

interface BlogCategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

async function fetchCategory(slug: string): Promise<Category | null> {
  // Try MySQL first
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadBlogCategoryBySlug } = await import('@/lib/db/blog-loader');
      const cat = await loadBlogCategoryBySlug(slug);
      if (cat) return cat;
    }
  } catch {}

  // GraphQL fallback
  const { getClient, REVALIDATE } = await import('@/lib/apollo/client');
  const { GET_CATEGORY_BY_SLUG } = await import('@/lib/queries/posts');
  const { data } = await getClient().query({
    query: GET_CATEGORY_BY_SLUG,
    variables: { slug },
    revalidate: REVALIDATE.NONE,
  });
  return data?.category || null;
}

export async function generateMetadata({ params }: BlogCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await fetchCategory(slug);

  if (!category) {
    return {
      title: 'Category Not Found | Guides',
    };
  }

  const description = category.description
    ? stripHtml(category.description).slice(0, 160)
    : `Browse ${category.name} articles on the Male Q blog. ${category.count} posts available.`;

  return {
    title: `${category.name} | Guides`,
    description,
    openGraph: {
      title: `${category.name} | Male Q Guides`,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${category.name} | Male Q Guides`,
      description,
    },
    alternates: {
      canonical: `/guides/category/${slug}`,
    },
  };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// ISR: Revalidate monthly — webhook handles real-time invalidation on post updates
export const revalidate = 2592000;
export const dynamicParams = true; // Allow runtime generation of any blog category page

export async function generateStaticParams() {
  // Try MySQL first
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadBlogCategories } = await import('@/lib/db/blog-loader');
      const cats = await loadBlogCategories();
      const params = cats
        .filter(cat => cat.count > 0)
        .map(cat => ({ slug: cat.slug }));
      return limitStaticParams(params, DEV_LIMITS.blogCategories);
    }
  } catch {}

  // GraphQL fallback
  try {
    const { getClient } = await import('@/lib/apollo/client');
    const { GET_ALL_CATEGORIES } = await import('@/lib/queries/posts');
    const { data } = await getClient().query({ query: GET_ALL_CATEGORIES });
    const cats: Array<{ slug: string; count: number }> = data?.categories?.nodes || [];
    const params = cats
      .filter(cat => cat.count > 0)
      .map(cat => ({ slug: cat.slug }));
    return limitStaticParams(params, DEV_LIMITS.blogCategories);
  } catch (error) {
    console.error('Error generating static params for blog categories:', error);
    return [];
  }
}

export default async function BlogCategoryPage({ params, searchParams }: BlogCategoryPageProps) {
  const { slug } = await params;
  const { q: searchQuery } = await searchParams;

  const category = await fetchCategory(slug);

  if (!category) {
    notFound();
  }

  // Fetch posts (with search if provided)
  const { posts, pageInfo } = searchQuery
    ? await searchBlogPosts(searchQuery, { first: 20, categorySlug: slug })
    : await getBlogPosts({ first: 12, categorySlug: slug });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      {/* Hero Section */}
      <div className="mb-8">
        {/* Breadcrumb Schema */}
        <BreadcrumbSchema
          items={[
            { name: 'Home', url: SITE_URL },
            { name: 'Guides', url: `${SITE_URL}/guides` },
            { name: 'Category', url: `${SITE_URL}/guides/category` },
            { name: category.name, url: `${SITE_URL}/guides/category/${slug}` },
          ]}
        />

        {/* Breadcrumb */}
        <Breadcrumbs
          items={[
            { label: 'Blog', href: '/guides' },
            { label: category.name },
          ]}
        />

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mt-4">
          <div>
            {/* Title */}
            <h1 className="text-4xl font-bold text-foreground">{category.name}</h1>

            {/* Description */}
            {category.description && (
              <p
                className="text-lg text-muted-foreground max-w-2xl mt-2"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(category.description) }}
              />
            )}

            {/* Post count / search results */}
            <p className="text-sm text-muted-foreground mt-2">
              {searchQuery
                ? posts.length === 0
                  ? `No articles found for "${searchQuery}"`
                  : `Showing ${posts.length} result${posts.length !== 1 ? 's' : ''} for "${searchQuery}"`
                : `${category.count} ${category.count === 1 ? 'article' : 'articles'} in this category`}
            </p>
          </div>

          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <BlogSearch />
          </Suspense>
        </div>
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: !searchQuery && pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
        categorySlug={slug}
      />

      {/* Back to blog */}
      <div className="mt-12 pt-8 border-t border-border">
        <Link
          href="/guides"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to all articles
        </Link>
      </div>
    </div>
  );
}
