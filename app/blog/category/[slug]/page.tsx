import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClient } from '@/lib/apollo/client';
import {
  GET_POSTS_BY_CATEGORY,
  GET_CATEGORY_BY_SLUG,
  GET_ALL_CATEGORIES,
} from '@/lib/queries/posts';
import BlogCard from '@/components/blog/BlogCard';
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
  });

  const categories: Category[] = data?.categories?.nodes || [];

  return categories
    .filter((cat) => cat.count > 0)
    .map((category) => ({
      slug: category.slug,
    }));
}

export const dynamic = 'force-dynamic';

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { slug } = await params;

  // Fetch category and posts in parallel
  const [categoryResult, postsResult] = await Promise.all([
    getClient().query({
      query: GET_CATEGORY_BY_SLUG,
      variables: { slug },
    }),
    getClient().query({
      query: GET_POSTS_BY_CATEGORY,
      variables: { categoryName: slug, first: 24 },
    }),
  ]);

  const category: Category | null = categoryResult.data?.category;
  const posts: Post[] = postsResult.data?.posts?.nodes || [];
  const pageInfo = postsResult.data?.posts?.pageInfo;

  if (!category) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="mb-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/blog" className="hover:text-foreground transition-colors">
            Blog
          </Link>
          <span>/</span>
          <span className="text-foreground">{category.name}</span>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-foreground mb-4">{category.name}</h1>

        {/* Description */}
        {category.description && (
          <p
            className="text-lg text-muted-foreground max-w-2xl mb-4"
            dangerouslySetInnerHTML={{ __html: category.description }}
          />
        )}

        {/* Post count */}
        <p className="text-sm text-muted-foreground">
          {posts.length} {posts.length === 1 ? 'article' : 'articles'} in this category
        </p>
      </div>

      {/* Posts Grid */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">No articles yet</h2>
          <p className="text-muted-foreground mb-6">
            There are no articles in this category yet. Check back soon!
          </p>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
          >
            Browse All Articles
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </Link>
        </div>
      )}

      {/* Pagination placeholder */}
      {pageInfo?.hasNextPage && (
        <div className="mt-12 text-center">
          <button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium">
            Load More Articles
          </button>
        </div>
      )}

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
