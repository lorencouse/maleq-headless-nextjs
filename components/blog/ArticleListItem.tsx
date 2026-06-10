'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';
import { formatPostDate } from '@/lib/utils/format-post-date';

interface ArticleListItemProps {
  post: Post;
  /** Hide the thumbnail for a tighter, text-only row. */
  showImage?: boolean;
}

/**
 * Compact horizontal article row: small thumbnail, category eyebrow, title,
 * date. Used for hero secondary stories and list-style sections.
 */
export default function ArticleListItem({ post, showImage = true }: ArticleListItemProps) {
  const locale = useLocale();
  const category = post.categories?.nodes?.[0];

  return (
    <article className="group flex gap-4 items-start py-4">
      {showImage && (
        <Link
          href={`/guides/${post.slug}`}
          className="relative flex-shrink-0 w-32 sm:w-36 rounded-md overflow-hidden bg-muted"
          style={{ aspectRatio: '16 / 9' }}
        >
          {post.featuredImage?.node ? (
            <Image
              src={getProductionImageUrl(post.featuredImage.node.sourceUrl)}
              alt={post.featuredImage.node.altText || post.title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="144px"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-muted to-border" />
          )}
        </Link>
      )}

      <div className="min-w-0 flex-1">
        {category && (
          <Link
            href={`/guides/category/${category.slug}`}
            className="text-xs font-semibold uppercase tracking-wide text-primary hover:text-primary-hover"
          >
            {category.name}
          </Link>
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
    </article>
  );
}
