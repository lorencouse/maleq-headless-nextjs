import { Metadata } from 'next';
import { getClient } from '@/lib/apollo/client';
import {
  GET_POST_BY_SLUG,
  GET_ALL_POST_SLUGS,
  GET_RELATED_POSTS,
} from '@/lib/queries/posts';
import RelatedPosts from '@/components/blog/RelatedPosts';
import CommentForm from '@/components/blog/CommentForm';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Post } from '@/lib/types/wordpress';
import {
  getProductionImageUrl,
  processWordPressContent,
} from '@/lib/utils/image';
import {
  extractProductIdsFromContent,
  fetchProductsByIds,
  productMapToObject,
} from '@/lib/utils/blog-products';
import VideoAutoplay from '@/components/blog/VideoAutoplay';
import StarRatingEnhancer from '@/components/blog/StarRatingEnhancer';
import CheckmarkEnhancer from '@/components/blog/CheckmarkEnhancer';
import AddToCartEnhancer from '@/components/blog/AddToCartEnhancer';
import DevEditLink from '@/components/dev/DevEditLink';
import { stripHtml } from '@/lib/utils/text-utils';
import './blog-post.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// ISR: Revalidate every 1 week for blog content
export const revalidate = 604800;
export const dynamicParams = true; // Allow runtime generation of any blog post

// Generate metadata for blog post
export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await getClient().query({
    query: GET_POST_BY_SLUG,
    variables: { slug },
    fetchPolicy: 'no-cache',
  });

  const post: Post = data?.postBy;

  if (!post) {
    return {
      title: 'Post Not Found | Male Q',
    };
  }

  // Strip HTML and limit description
  const description = post.excerpt
    ? stripHtml(post.excerpt).slice(0, 160)
    : post.content
      ? stripHtml(post.content).slice(0, 160)
      : `Read ${post.title} on the Male Q blog.`;

  return {
    title: `${post.title} | Male Q Blog`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: `${SITE_URL}/blog/${slug}`,
      type: 'article',
      publishedTime: post.date,
      authors: post.author?.node?.name ? [post.author.node.name] : undefined,
      images: post.featuredImage?.node?.sourceUrl
        ? [
            {
              url: getProductionImageUrl(post.featuredImage.node.sourceUrl),
              width: 1200,
              height: 630,
              alt: post.featuredImage.node.altText || post.title,
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: post.featuredImage?.node?.sourceUrl
        ? [getProductionImageUrl(post.featuredImage.node.sourceUrl)]
        : [],
    },
    alternates: {
      canonical: `${SITE_URL}/blog/${slug}`,
    },
  };
}

// Generate static params for all posts
export async function generateStaticParams() {
  const { data } = await getClient().query({
    query: GET_ALL_POST_SLUGS,
    fetchPolicy: 'no-cache',
  });

  const params =
    data?.posts?.nodes?.map((post: { slug: string }) => ({
      slug: post.slug,
    })) || [];

  return limitStaticParams(params, DEV_LIMITS.blogPosts);
}

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;

  const { data } = await getClient().query({
    query: GET_POST_BY_SLUG,
    variables: { slug },
    fetchPolicy: 'no-cache',
  });

  const post: Post = data?.postBy;

  if (!post) {
    notFound();
  }

  // Fetch related posts from the same category
  let relatedPosts: Post[] = [];
  if (post.categories?.nodes && post.categories.nodes.length > 0) {
    const categorySlug = post.categories.nodes[0].slug;
    const { data: relatedData } = await getClient().query({
      query: GET_RELATED_POSTS,
      variables: { categorySlug, first: 10 },
      fetchPolicy: 'no-cache',
    });
    relatedPosts = relatedData?.posts?.nodes || [];
  }

  // Extract and batch fetch products from WooCommerce shortcodes in content
  const productIds = extractProductIdsFromContent(post.content);
  const productMap = await fetchProductsByIds(productIds);
  const blogProducts = productMapToObject(productMap);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <article className='single-post max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
      {/* Dev: Edit in WordPress link */}
      <DevEditLink type="post" databaseId={post.databaseId} />

      {/* Header */}
      <header className='entry-header mb-8'>
        {/* Categories */}
        {post.categories?.nodes && post.categories.nodes.length > 0 && (
          <div className='flex flex-wrap gap-2 mb-4'>
            {post.categories.nodes.map((category: any) => (
              <Link
                key={category.id}
                href={`/blog/category/${category.slug}`}
                className='text-sm font-medium text-primary hover:text-primary-hover'
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className='entry-title text-4xl md:text-5xl font-bold text-foreground mb-6'>
          {post.title}
        </h1>

        {/* Meta */}
        <div className='flex items-center gap-4 text-muted-foreground'>
          <div className='flex items-center gap-2'>
            {post.author?.node?.avatar?.url && (
              <Image
                src='/images/Mr-Q-profile.png'
                alt={post.author.node.name}
                width={40}
                height={40}
                className='rounded-full'
              />
            )}
            <span className='font-medium'>{post.author?.node?.name}</span>
          </div>
          <span>•</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          {post.comments?.nodes && post.comments.nodes.length > 0 && (
            <>
              <span>•</span>
              <span>
                {post.comments.nodes.length}{' '}
                {post.comments.nodes.length === 1 ? 'comment' : 'comments'}
              </span>
            </>
          )}
        </div>
      </header>

      {/* Featured Image */}
      {post.featuredImage?.node && (
        <div className='entry-img relative w-full h-96 mb-8 rounded-lg overflow-hidden'>
          <Image
            src={getProductionImageUrl(post.featuredImage.node.sourceUrl)}
            alt={post.featuredImage.node.altText || post.title}
            fill
            className='object-cover'
            priority
          />
        </div>
      )}

      {/* Content */}
      <div
        className='entry-content prose prose-lg max-w-none mb-12 blog-content'
        dangerouslySetInnerHTML={{
          __html: processWordPressContent(post.content),
        }}
      />

      {/* Enable lazy loading autoplay for videos */}
      <VideoAutoplay />

      {/* Enhance star ratings in product specs */}
      <StarRatingEnhancer />

      {/* Enhance checkmarks in product specs tables */}
      <CheckmarkEnhancer />

      {/* Intercept add-to-cart links and use local cart */}
      <AddToCartEnhancer products={blogProducts} />

      {/* Tags */}
      {post.tags?.nodes && post.tags.nodes.length > 0 && (
        <div className='border-t border-border pt-6 mb-12'>
          <h3 className='text-sm font-semibold text-foreground mb-3'>Tags:</h3>
          <div className='flex flex-wrap gap-2'>
            {post.tags.nodes.map((tag: any) => (
              <Link
                key={tag.id}
                href={`/blog/tag/${tag.slug}`}
                className='px-3 py-1 bg-input text-foreground text-sm rounded-full hover:bg-border transition-colors'
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Related Posts */}
      <RelatedPosts posts={relatedPosts} currentSlug={slug} />

      {/* Comments Section */}
      <div className='border-t border-border py-8'>
        <h2 className='text-2xl font-bold text-foreground mb-6'>
          Comments{' '}
          {post.comments?.nodes && post.comments.nodes.length > 0
            ? `(${post.comments.nodes.length})`
            : ''}
        </h2>

        {/* Comment Form */}
        <div className='bg-card border border-border rounded-lg p-6 my-8'>
          <h3 className='heading-plain text-lg font-semibold text-foreground mb-4'>
            Leave a Comment
          </h3>
          <CommentForm postId={post.databaseId} />
        </div>

        {/* Existing Comments */}
        {post.comments?.nodes && post.comments.nodes.length > 0 && (() => {
          // Helper to check if author is admin/Mr. Q
          const isAdmin = (name: string | undefined) => {
            if (!name) return false;
            const lower = name.toLowerCase();
            return lower.includes('mr') || lower.includes('admin') || lower === 'maleq';
          };

          // Separate top-level comments and replies
          const topLevelComments = post.comments.nodes.filter(
            (c: any) => !c.parent?.node?.id
          );
          const replies = post.comments.nodes.filter(
            (c: any) => c.parent?.node?.id
          );

          // Get replies for a specific comment
          const getReplies = (commentId: string) =>
            replies.filter((r: any) => r.parent?.node?.id === commentId);

          return (
            <div className='space-y-6'>
              {topLevelComments.map((comment: any) => (
                <div key={comment.id}>
                  {/* Parent Comment */}
                  <div className='bg-card border border-border rounded-lg p-6'>
                    <div className='flex items-start gap-4'>
                      <Image
                        src={isAdmin(comment.author?.node?.name)
                          ? '/images/Mr-Q-profile.png'
                          : '/images/MQ-logo.png'
                        }
                        alt={comment.author?.node?.name || 'User'}
                        width={48}
                        height={48}
                        className='rounded-full'
                      />
                      <div className='flex-1'>
                        <div className='flex items-center gap-2 mb-2'>
                          <span className='font-semibold text-foreground'>
                            {comment.author?.node?.name}
                          </span>
                          <span className='text-sm text-muted-foreground'>
                            {formatDate(comment.date)}
                          </span>
                        </div>
                        <div
                          className='text-muted-foreground'
                          dangerouslySetInnerHTML={{
                            __html: processWordPressContent(comment.content),
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Replies */}
                  {getReplies(comment.id).length > 0 && (
                    <div className='ml-8 mt-4 space-y-4'>
                      {getReplies(comment.id).map((reply: any) => (
                        <div
                          key={reply.id}
                          className='bg-muted/50 border border-border rounded-lg p-4'
                        >
                          <div className='flex items-start gap-3'>
                            <Image
                              src={isAdmin(reply.author?.node?.name)
                                ? '/images/Mr-Q-profile.png'
                                : '/images/MQ-logo.png'
                              }
                              alt={reply.author?.node?.name || 'User'}
                              width={40}
                              height={40}
                              className='rounded-full'
                            />
                            <div className='flex-1'>
                              <div className='flex items-center gap-2 mb-2'>
                                <span className='font-semibold text-foreground text-sm'>
                                  {reply.author?.node?.name}
                                </span>
                                <span className='text-xs text-muted-foreground'>
                                  {formatDate(reply.date)}
                                </span>
                              </div>
                              <div
                                className='text-muted-foreground text-sm'
                                dangerouslySetInnerHTML={{
                                  __html: processWordPressContent(reply.content),
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </article>
  );
}
