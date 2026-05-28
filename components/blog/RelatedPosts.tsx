import { getTranslations } from 'next-intl/server';
import { Post } from '@/lib/types/wordpress';
import BlogCard from '@/components/blog/BlogCard';

interface RelatedPostsProps {
  posts: Post[];
  currentSlug: string;
  /** Explicit UI locale for guide routes where setRequestLocale() is a no-op. */
  locale?: string;
}

export default async function RelatedPosts({
  posts,
  currentSlug,
  locale,
}: RelatedPostsProps) {
  // Filter out the current post and limit to 3
  const relatedPosts = posts
    .filter((post) => post.slug !== currentSlug)
    .slice(0, 3);

  if (relatedPosts.length === 0) {
    return null;
  }

  const t = locale
    ? await getTranslations({ locale, namespace: 'blog' })
    : await getTranslations('blog');

  return (
    <section className='border-t border-border pt-8 mt-12'>
      <h2 className='text-2xl font-bold text-foreground'>{t('relatedArticlesHeading')}</h2>
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-8'>
        {relatedPosts.map((post) => (
          <BlogCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
