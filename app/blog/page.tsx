import { getClient } from '@/lib/apollo/client';
import { GET_ALL_POSTS } from '@/lib/queries/posts';
import BlogCard from '@/components/blog/BlogCard';
import { Post } from '@/lib/types/wordpress';

export const dynamic = 'force-dynamic'; // Use dynamic rendering

export default async function BlogPage() {
  const { data } = await getClient().query({
    query: GET_ALL_POSTS,
    variables: {
      first: 12,
    },
  });

  const posts: Post[] = data?.posts?.nodes || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Blog</h1>
        <p className="text-lg text-gray-600">
          Insights, stories, and updates from our team
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
        <div className="text-center py-12">
          <p className="text-gray-600">No blog posts found.</p>
        </div>
      )}

      {/* Pagination - to be implemented */}
      {data?.posts?.pageInfo?.hasNextPage && (
        <div className="mt-12 text-center">
          <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Load More Posts
          </button>
        </div>
      )}
    </div>
  );
}
