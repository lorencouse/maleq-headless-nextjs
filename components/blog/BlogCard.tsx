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

  return (
    <article className='bg-card border border-border rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all'>
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
        {/* Categories & Date */}
        <div className='flex justify-between items-center mb-3'>
          {post.categories?.nodes && post.categories.nodes.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              {post.categories.nodes.slice(0, 2).map((category) => (
                <Link
                  key={category.id}
                  href={`/blog/category/${category.slug}`}
                  className='text-xs font-medium text-primary hover:text-primary-hover'
                >
                  {category.name}
                </Link>
              ))}
            </div>
          )}
          <time dateTime={post.date} className='text-xs text-muted-foreground whitespace-nowrap ml-2'>
            {formatDate(post.date)}
          </time>
        </div>

        {/* Title */}
        <div className='border-b-4 border-black dark:border-white pb-2 mb-2'>
          <h2 className='heading-plain text-xl font-bold text-foreground line-clamp-2'>
            <Link
              href={`/blog/${post.slug}`}
              className='hover:text-primary transition-colors'
            >
              {post.title}
            </Link>
          </h2>
        </div>

        {/* Excerpt */}
        {/* <div
          className='text-muted-foreground text-sm mb-4 line-clamp-3'
          dangerouslySetInnerHTML={{ __html: post.excerpt }}
        /> */}

        {/* Meta Info */}
        <div className='flex items-center justify-between text-sm text-muted-foreground border-t border-border mt-3 pt-3'>
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
          {post.commentCount !== undefined && post.commentCount > 0 && (
            <div className=' '>
              <span className='text-xs text-muted-foreground'>
                {post.commentCount}{' '}
                {post.commentCount === 1 ? 'comment' : 'comments'}
              </span>
            </div>
          )}
        </div>

        {/* Comment Count */}
      </div>
    </article>
  );
}
