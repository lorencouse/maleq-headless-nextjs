import { Metadata } from 'next';
import { Suspense } from 'react';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import DidYouMean from '@/components/search/DidYouMean';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const { q: searchQuery } = await searchParams;

  if (searchQuery) {
    return {
      title: `Search results for "${searchQuery}" | Guides | Male Q`,
      description: `Browse guide search results for "${searchQuery}".`,
      robots: { index: false },
    };
  }

  return {
    title: 'Guides | Male Q',
    description: 'Read the latest articles, guides, and insights from Male Q. Tips, product reviews, and expert advice for your intimate wellness.',
    openGraph: {
      title: 'Guides | Male Q',
      description: 'Read the latest articles, guides, and insights from Male Q.',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: 'Guides | Male Q',
      description: 'Read the latest articles, guides, and insights from Male Q.',
    },
    alternates: {
      canonical: '/guides',
    },
  };
}

// ISR: Revalidate every 1 week for blog content
export const revalidate = 604800;

interface BlogPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { q: searchQuery } = await searchParams;

  // Use search if provided, otherwise get all posts
  const result = searchQuery
    ? await searchBlogPosts(searchQuery, { first: 20 })
    : await getBlogPosts({ first: 12 });

  const { posts, pageInfo, suggestions } = result;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      <Breadcrumbs items={[{ label: 'Guides' }]} />

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">Guides</h1>
            <p className="text-lg text-muted-foreground">
              Insights, stories, and updates from our team
            </p>
          </div>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <BlogSearch />
          </Suspense>
        </div>

        {/* Did you mean? suggestions when no results */}
        {suggestions && searchQuery && posts.length === 0 && (
          <DidYouMean suggestions={suggestions} basePath="/guides" />
        )}

        {/* Search results indicator */}
        {searchQuery && (
          <p className="text-sm text-muted-foreground">
            {posts.length === 0
              ? `No articles found for "${searchQuery}"`
              : `Showing ${posts.length} result${posts.length !== 1 ? 's' : ''} for "${searchQuery}"`}
          </p>
        )}
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: !searchQuery && pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
      />
    </div>
  );
}
