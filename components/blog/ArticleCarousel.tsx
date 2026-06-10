'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import BlogCard from './BlogCard';
import { useHorizontalScroll } from '@/lib/hooks/useHorizontalScroll';

interface ArticleCarouselProps {
  posts: Post[];
  title: string;
  viewAllLink?: string;
  minItemsForArrows?: number;
}

/**
 * Horizontal rail of article cards with overlay arrows and snap scrolling.
 * Mirrors the product ProductCarousel pattern, reusing useHorizontalScroll.
 */
export default function ArticleCarousel({
  posts,
  title,
  viewAllLink,
  minItemsForArrows = 3,
}: ArticleCarouselProps) {
  const t = useTranslations('blog');
  const { scrollContainerRef, canScrollLeft, canScrollRight, scrollLeft, scrollRight, checkScroll } =
    useHorizontalScroll({ cardWidth: 320 });

  if (posts.length === 0) return null;
  const showArrows = posts.length > minItemsForArrows;

  return (
    <section>
      {/* Section header */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="relative text-2xl sm:text-3xl font-bold text-foreground pl-3 border-l-4 border-primary">
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

      <div className="relative">
        {showArrows && (
          <>
            <button
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted transition-all disabled:opacity-0"
              aria-label={t('scrollLeftAria')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={scrollRight}
              disabled={!canScrollRight}
              className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted transition-all disabled:opacity-0"
              aria-label={t('scrollRightAria')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className="flex gap-4 sm:gap-6 overflow-x-auto pb-2 snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {posts.map((post) => (
            <div key={post.id} className="flex-shrink-0 snap-start w-[280px] sm:w-[300px]">
              <BlogCard post={post} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
