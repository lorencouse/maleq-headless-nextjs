import { getClient } from '@/lib/apollo/client';
import { GET_POST_BY_SLUG, GET_ALL_POST_SLUGS } from '@/lib/queries/posts';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const revalidate = 3600; // Revalidate every hour

// Generate static params for all posts
export async function generateStaticParams() {
  const { data } = await getClient().query({
    query: GET_ALL_POST_SLUGS,
  });

  return data?.posts?.nodes?.map((post: { slug: string }) => ({
    slug: post.slug,
  })) || [];
}

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;

  const { data } = await getClient().query({
    query: GET_POST_BY_SLUG,
    variables: { slug },
  });

  const post = data?.postBy;

  if (!post) {
    notFound();
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <header className="mb-8">
        {/* Categories */}
        {post.categories?.nodes && post.categories.nodes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.categories.nodes.map((category: any) => (
              <Link
                key={category.id}
                href={`/blog/category/${category.slug}`}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
          {post.title}
        </h1>

        {/* Meta */}
        <div className="flex items-center gap-4 text-gray-600">
          <div className="flex items-center gap-2">
            {post.author?.node?.avatar?.url && (
              <Image
                src={post.author.node.avatar.url}
                alt={post.author.node.name}
                width={40}
                height={40}
                className="rounded-full"
              />
            )}
            <span className="font-medium">{post.author?.node?.name}</span>
          </div>
          <span>•</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          {post.commentCount > 0 && (
            <>
              <span>•</span>
              <span>{post.commentCount} comments</span>
            </>
          )}
        </div>
      </header>

      {/* Featured Image */}
      {post.featuredImage?.node && (
        <div className="relative w-full h-96 mb-8 rounded-lg overflow-hidden">
          <Image
            src={post.featuredImage.node.sourceUrl}
            alt={post.featuredImage.node.altText || post.title}
            fill
            className="object-cover"
            priority
          />
        </div>
      )}

      {/* Content */}
      <div
        className="prose prose-lg max-w-none mb-12"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />

      {/* Tags */}
      {post.tags?.nodes && post.tags.nodes.length > 0 && (
        <div className="border-t border-gray-200 pt-6 mb-12">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Tags:</h3>
          <div className="flex flex-wrap gap-2">
            {post.tags.nodes.map((tag: any) => (
              <Link
                key={tag.id}
                href={`/blog/tag/${tag.slug}`}
                className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full hover:bg-gray-200 transition-colors"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Comments Section */}
      {post.comments?.nodes && post.comments.nodes.length > 0 && (
        <div className="border-t border-gray-200 pt-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Comments ({post.commentCount})
          </h2>
          <div className="space-y-6">
            {post.comments.nodes.map((comment: any) => (
              <div key={comment.id} className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-start gap-4">
                  {comment.author?.node?.avatar?.url && (
                    <Image
                      src={comment.author.node.avatar.url}
                      alt={comment.author.node.name}
                      width={48}
                      height={48}
                      className="rounded-full"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">
                        {comment.author?.node?.name}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(comment.date)}
                      </span>
                    </div>
                    <div
                      className="text-gray-700"
                      dangerouslySetInnerHTML={{ __html: comment.content }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
