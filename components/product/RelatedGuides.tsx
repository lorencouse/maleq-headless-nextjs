import { Post } from '@/lib/types/wordpress';
import BlogCard from '@/components/blog/BlogCard';

interface RelatedGuidesProps {
  posts: Post[];
}

/**
 * "Related Guides" block on a product page — the reverse of the post ⇄ product
 * relation: guides that recommend this product (or its categories).
 * Renders nothing when there are no related guides.
 */
export default function RelatedGuides({ posts }: RelatedGuidesProps) {
  if (!posts || posts.length === 0) {
    return null;
  }

  return (
    <section className='max-w-7xl mx-auto mt-4'>
      <h2 className='text-2xl font-bold text-foreground mb-6'>Related Guides</h2>
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'>
        {posts.slice(0, 3).map((post) => (
          <BlogCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
