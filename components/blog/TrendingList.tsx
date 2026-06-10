'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import { formatPostDate } from '@/lib/utils/format-post-date';

interface TrendingListProps {
  posts: Post[];
}

/**
 * Numbered "Trending" list — a dense, scannable rhythm distinct from the card
 * grids and rails. Big ghosted rank numbers lead each row.
 */
export default function TrendingList({ posts }: TrendingListProps) {
  const locale = useLocale();
  const t = useTranslations('news');
  if (posts.length === 0) return null;

  return (
    <section>
      <h2 className="mb-5 border-l-4 border-primary pl-3 text-2xl sm:text-3xl font-bold text-foreground">
        {t('trending')}
      </h2>
      <ol className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        {posts.map((post, i) => {
          const category = post.categories?.nodes?.[0];
          return (
            <li key={post.id} className="group flex items-start gap-4 border-b border-border py-4">
              <span className="w-8 flex-shrink-0 text-3xl font-extrabold leading-none text-primary/30">
                {i + 1}
              </span>
              <div className="min-w-0">
                {category && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {category.name}
                  </span>
                )}
                <h3 className="heading-plain mt-1 text-base font-bold leading-snug text-foreground line-clamp-2">
                  <Link href={`/guides/${post.slug}`} className="hover:text-primary transition-colors">
                    {post.title}
                  </Link>
                </h3>
                <time dateTime={post.date} className="mt-1 block text-xs text-muted-foreground">
                  {formatPostDate(post.date, locale)}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
