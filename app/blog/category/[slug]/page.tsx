import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { getClient } from '@/lib/apollo/client';
import {
  GET_POSTS_BY_CATEGORY,
  GET_CATEGORY_BY_SLUG,
  GET_ALL_CATEGORIES,
} from '@/lib/queries/posts';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import { Post } from '@/lib/types/wordpress';

interface BlogCategoryPageProps {
  params: Promise<{ slug: string }>;
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

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { slug } = await params;

  // Fetch category and posts in parallel
  const [categoryResult, postsResult] = await Promise.all([
    getClient().query({
      query: GET_CATEGORY_BY_SLUG,
      variables: { slug },
      fetchPolicy: 'no-cache',
    }),
    getClient().query({
      query: GET_POSTS_BY_CATEGORY,
      variables: { categoryName: slug, first: 12 },
      fetchPolicy: 'no-cache',
    }),
  ]);

  const category: Category | null = categoryResult.data?.category;
  const posts: Post[] = postsResult.data?.posts?.nodes || [];
  const pageInfo = postsResult.data?.posts?.pageInfo || {
    hasNextPage: false,
    endCursor: null,
  };

  if (!category) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="mb-12">
        {/* Breadcrumb */}
        <Breadcrumbs
          items={[
            { label: 'Blog', href: '/blog' },
            { label: category.name },
          ]}
        />

        {/* Title */}
        <h1 className="text-4xl font-bold text-foreground">{category.name}</h1>

        {/* Description */}
        {category.description && (
          <p
            className="text-lg text-muted-foreground max-w-2xl mb-4"
            dangerouslySetInnerHTML={{ __html: category.description }}
          />
        )}

        {/* Post count */}
        <p className="text-sm text-muted-foreground">
          {category.count} {category.count === 1 ? 'article' : 'articles'} in this category
        </p>
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: pageInfo.hasNextPage,
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
