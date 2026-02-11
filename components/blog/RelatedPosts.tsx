import { Post } from '@/lib/types/wordpress';
import BlogCard from '@/components/blog/BlogCard';

interface RelatedPostsProps {
  posts: Post[];
  currentSlug: string;
}

export default function RelatedPosts({
  posts,
  currentSlug,
}: RelatedPostsProps) {
  // Filter out the current post and limit to 3
  const relatedPosts = posts
    .filter((post) => post.slug !== currentSlug)
    .slice(0, 3);

  if (relatedPosts.length === 0) {
    return null;
  }

  return (
    <section className='border-t border-border pt-8 mt-12'>
      <h2 className='text-2xl font-bold text-foreground'>Related Articles</h2>
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-8'>
        {relatedPosts.map((post) => (
          <BlogCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
