import { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { getClient } from '@/lib/apollo/client';
import { GET_CATEGORY_BY_SLUG, GET_ALL_CATEGORIES } from '@/lib/queries/posts';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';

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

export async function generateMetadata({ params }: BlogCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;

  const { data } = await getClient().query({
    query: GET_CATEGORY_BY_SLUG,
    variables: { slug },
    fetchPolicy: 'no-cache',
  });

  const category: Category | null = data?.category;

  if (!category) {
    return {
      title: 'Category Not Found | Male Q Blog',
    };
  }

  const description = category.description
    ? category.description.replace(/<[^>]*>/g, '').slice(0, 160)
    : `Browse ${category.name} articles on the Male Q blog. ${category.count} posts available.`;

  return {
    title: `${category.name} | Male Q Blog`,
    description,
    openGraph: {
      title: `${category.name} | Male Q Blog`,
      description,
      type: 'website',
    },
  };
}

export async function generateStaticParams() {
  const { data } = await getClient().query({
    query: GET_ALL_CATEGORIES,
    fetchPolicy: 'no-cache',
  });

  const categories: Category[] = data?.categories?.nodes || [];

  const params = categories
    .filter((cat) => cat.count > 0)
    .map((category) => ({
      slug: category.slug,
    }));

  return limitStaticParams(params, DEV_LIMITS.blogCategories);
}

// ISR: Revalidate every 1 week for blog content
export const revalidate = 604800;
export const dynamicParams = true; // Allow runtime generation

export default async function BlogCategoryPage({ params, searchParams }: BlogCategoryPageProps) {
  const { slug } = await params;
  const { q: searchQuery } = await searchParams;

  // Fetch category first
  const categoryResult = await getClient().query({
    query: GET_CATEGORY_BY_SLUG,
    variables: { slug },
    fetchPolicy: 'no-cache',
  });

  const category: Category | null = categoryResult.data?.category;

  if (!category) {
    notFound();
  }

  // Fetch posts (with search if provided)
  const { posts, pageInfo } = searchQuery
    ? await searchBlogPosts(searchQuery, { first: 20, categorySlug: slug })
    : await getBlogPosts({ first: 12, categorySlug: slug });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="mb-8">
        {/* Breadcrumb */}
        <Breadcrumbs
          items={[
            { label: 'Blog', href: '/blog' },
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
                dangerouslySetInnerHTML={{ __html: category.description }}
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
          href="/blog"
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
