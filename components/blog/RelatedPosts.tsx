import Link from 'next/link';
import Image from 'next/image';
import { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';

interface RelatedPostsProps {
  posts: Post[];
  currentSlug: string;
}

export default function RelatedPosts({
  posts,
  currentSlug,
}: RelatedPostsProps) {
  // Filter out the current post and limit to 4
  const relatedPosts = posts
    .filter((post) => post.slug !== currentSlug)
    .slice(0, 4);

  if (relatedPosts.length === 0) {
    return null;
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <section className='border-t border-border pt-8 mt-12'>
      <h2 className='text-2xl font-bold text-foreground'>Related Articles</h2>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-2 py-8'>
        {relatedPosts.map((post) => (
          <article
            key={post.id}
            className='bg-card border border-border rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-all group'
          >
            {/* Featured Image */}
            <Link href={`/blog/${post.slug}`}>
              <div className='relative h-32 md:h-40 w-full overflow-hidden'>
                {post.featuredImage?.node ? (
                  <Image
                    src={getProductionImageUrl(
                      post.featuredImage.node.sourceUrl,
                    )}
                    alt={post.featuredImage.node.altText || post.title}
                    fill
                    className='object-cover group-hover:scale-105 transition-transform duration-300'
                    sizes='(max-width: 768px) 50vw, 25vw'
                  />
                ) : (
                  <div className='w-full h-full bg-muted flex items-center justify-center'>
                    <span className='text-muted-foreground text-sm'>
                      No image
                    </span>
                  </div>
                )}
              </div>
            </Link>

            <div className='p-3 md:p-4'>
              {/* Category */}
              {post.categories?.nodes && post.categories.nodes.length > 0 && (
                <Link
                  href={`/blog/category/${post.categories.nodes[0].slug}`}
                  className='text-xs font-medium text-primary hover:text-primary-hover'
                >
                  {post.categories.nodes[0].name}
                </Link>
              )}

              {/* Title */}
              <div className='border-b-2 border-primary pb-2 mt-1 mb-2'>
                <h3 className='heading-plain text-sm md:text-base font-bold text-foreground line-clamp-2 leading-tight'>
                  <Link
                    href={`/blog/${post.slug}`}
                    className='hover:text-primary transition-colors'
                  >
                    {post.title}
                  </Link>
                </h3>
              </div>

              {/* Date */}
              <time
                dateTime={post.date}
                className='text-xs text-muted-foreground'
              >
                {formatDate(post.date)}
              </time>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
