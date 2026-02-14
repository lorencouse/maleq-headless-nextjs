'use client';

import { useState, useTransition } from 'react';
import BlogCard from './BlogCard';
import { Post } from '@/lib/types/wordpress';

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface BlogPostsGridProps {
  initialPosts: Post[];
  initialPageInfo: PageInfo;
  categorySlug?: string;
  tagSlug?: string;
  excludeCategories?: string;
}

async function fetchMorePosts(
  cursor: string,
  categorySlug?: string,
  tagSlug?: string,
  excludeCategories?: string
): Promise<{ posts: Post[]; pageInfo: PageInfo }> {
  const params = new URLSearchParams({
    after: cursor,
    first: '12',
  });

  if (categorySlug) {
    params.set('category', categorySlug);
  }
  if (tagSlug) {
    params.set('tag', tagSlug);
  }
  if (excludeCategories) {
    params.set('excludeCategories', excludeCategories);
  }

  const response = await fetch(`/api/posts?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch posts');
  }

  return response.json();
}

export default function BlogPostsGrid({
  initialPosts,
  initialPageInfo,
  categorySlug,
  tagSlug,
  excludeCategories,
}: BlogPostsGridProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [pageInfo, setPageInfo] = useState<PageInfo>(initialPageInfo);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const loadMore = () => {
    if (!pageInfo.endCursor || isPending) return;

    setError(null);

    startTransition(async () => {
      try {
        const result = await fetchMorePosts(pageInfo.endCursor!, categorySlug, tagSlug, excludeCategories);
        setPosts((prev) => [...prev, ...result.posts]);
        setPageInfo(result.pageInfo);
      } catch (err) {
        setError('Failed to load more posts. Please try again.');
        console.error('Error loading more posts:', err);
      }
    });
  };

  return (
    <>
      {/* Posts Grid */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No blog posts found.</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-8 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      {/* Load More Button */}
      {pageInfo.hasNextPage && (
        <div className="mt-12 text-center">
          <button
            onClick={loadMore}
            disabled={isPending}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isPending ? (
              <>
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Loading...
              </>
            ) : (
              'Load More Posts'
            )}
          </button>
        </div>
      )}
    </>
  );
}
