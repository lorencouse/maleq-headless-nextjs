'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import BlogCard from './BlogCard';
import ArticleListItem from './ArticleListItem';
import ArticleCarousel from './ArticleCarousel';

export type TopicLayout = 'carousel' | 'grid' | 'list';

interface TopicSectionProps {
  title: string;
  posts: Post[];
  viewAllLink?: string;
  layout: TopicLayout;
}

function SectionHeader({ title, viewAllLink }: { title: string; viewAllLink?: string }) {
  const t = useTranslations('blog');
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground pl-3 border-l-4 border-primary">
        {title}
      </h2>
      {viewAllLink && (
        <Link
          href={viewAllLink}
          className="flex-shrink-0 text-sm font-medium text-primary hover:text-primary-hover inline-flex items-center gap-1"
        >
          {t('viewAllSection')}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>
  );
}

/**
 * One topic block on a landing page, rendered in one of three layouts so the
 * page reads with the visual variety of a real news site.
 */
export default function TopicSection({ title, posts, viewAllLink, layout }: TopicSectionProps) {
  if (posts.length === 0) return null;

  if (layout === 'carousel') {
    return <ArticleCarousel posts={posts} title={title} viewAllLink={viewAllLink} />;
  }

  if (layout === 'list') {
    return (
      <section>
        <SectionHeader title={title} viewAllLink={viewAllLink} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
          {posts.slice(0, 6).map((post) => (
            <div key={post.id} className="border-b border-border last:border-b-0">
              <ArticleListItem post={post} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // grid
  return (
    <section>
      <SectionHeader title={title} viewAllLink={viewAllLink} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {posts.slice(0, 6).map((post) => (
          <BlogCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
