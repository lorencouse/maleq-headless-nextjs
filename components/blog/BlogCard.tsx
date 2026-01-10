import Link from 'next/link';
import Image from 'next/image';
import { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';

interface BlogCardProps {
  post: Post;
}

export default function BlogCard({ post }: BlogCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (post.featuredImage?.node) {
    console.log('Image URL:', post.featuredImage.node.sourceUrl);
  } else {
    console.log('No featured image available for this post.');
  }

  return (
    <article className='bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow'>
      {/* Featured Image */}
      {post.featuredImage?.node && (
        <Link href={`/blog/${post.slug}`}>
          <div className='relative h-48 w-full'>
            <Image
              src={getProductionImageUrl(post.featuredImage.node.sourceUrl)}
              alt={post.featuredImage.node.altText || post.title}
              fill
              className='object-cover'
              sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
            />
          </div>
        </Link>
      )}

      <div className='p-6'>
        {/* Categories */}
        {post.categories?.nodes && post.categories.nodes.length > 0 && (
          <div className='flex flex-wrap gap-2 mb-3'>
            {post.categories.nodes.slice(0, 2).map((category) => (
              <Link
                key={category.id}
                href={`/blog/category/${category.slug}`}
                className='text-xs font-medium text-blue-600 hover:text-blue-800'
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h2 className='text-xl font-bold text-gray-900 mb-2 line-clamp-2'>
          <Link
            href={`/blog/${post.slug}`}
            className='hover:text-blue-600 transition-colors'
          >
            {post.title}
          </Link>
        </h2>

        {/* Excerpt */}
        <div
          className='text-gray-600 text-sm mb-4 line-clamp-3'
          dangerouslySetInnerHTML={{ __html: post.excerpt }}
        />

        {/* Meta Info */}
        <div className='flex items-center justify-between text-sm text-gray-500'>
          <div className='flex items-center space-x-2'>
            {post.author?.node?.avatar?.url && (
              <Image
                src='/images/Mr-Q-profile.png'
                alt={post.author.node.name}
                width={24}
                height={24}
                className='rounded-full'
              />
            )}
            <span>{post.author?.node?.name}</span>
          </div>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
        </div>

        {/* Comment Count */}
        {post.commentCount !== undefined && post.commentCount > 0 && (
          <div className='mt-3 pt-3 border-t border-gray-200'>
            <span className='text-xs text-gray-500'>
              {post.commentCount}{' '}
              {post.commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
