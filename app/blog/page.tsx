import { Metadata } from 'next';
import { Suspense } from 'react';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';

export const metadata: Metadata = {
  title: 'Blog | Male Q',
  description: 'Read the latest articles, guides, and insights from Male Q. Tips, product reviews, and expert advice for your intimate wellness.',
  openGraph: {
    title: 'Blog | Male Q',
    description: 'Read the latest articles, guides, and insights from Male Q.',
    type: 'website',
  },
};

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

  const { posts, pageInfo, correctedTerm } = result;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">Blog</h1>
            <p className="text-lg text-muted-foreground">
              Insights, stories, and updates from our team
            </p>
          </div>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <BlogSearch />
          </Suspense>
        </div>

        {/* Spelling Correction Notice */}
        {correctedTerm && searchQuery && (
          <div className="mb-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <p className="text-sm text-foreground">
              Showing results for <span className="font-semibold text-primary">&quot;{correctedTerm}&quot;</span>
              <span className="text-muted-foreground ml-1">
                (searched for &quot;{searchQuery}&quot;)
              </span>
            </p>
          </div>
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
