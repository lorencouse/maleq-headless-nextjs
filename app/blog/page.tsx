import { Metadata } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_POSTS } from '@/lib/queries/posts';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import { Post } from '@/lib/types/wordpress';

export const metadata: Metadata = {
  title: 'Blog | Male Q',
  description: 'Read the latest articles, guides, and insights from Male Q. Tips, product reviews, and expert advice for your intimate wellness.',
  openGraph: {
    title: 'Blog | Male Q',
    description: 'Read the latest articles, guides, and insights from Male Q.',
    type: 'website',
  },
};

// ISR: Revalidate every 5 minutes for fresh content
export const revalidate = 300;

export default async function BlogPage() {
  const { data } = await getClient().query({
    query: GET_ALL_POSTS,
    variables: {
      first: 12,
    },
    fetchPolicy: 'no-cache',
  });

  const posts: Post[] = data?.posts?.nodes || [];
  const pageInfo = data?.posts?.pageInfo || {
    hasNextPage: false,
    endCursor: null,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-foreground mb-4">Blog</h1>
        <p className="text-lg text-muted-foreground">
          Insights, stories, and updates from our team
        </p>
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
      />
    </div>
  );
}
