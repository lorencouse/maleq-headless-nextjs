'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';
import { formatPostDate } from '@/lib/utils/format-post-date';

interface FeatureSpotlightProps {
  post: Post;
}

/**
 * Full-width "slow down and read this" beat: large image beside a generous
 * text block. A deliberate contrast to the card grids and rails.
 * Image container uses an explicit height so next/image `fill` can resolve.
 */
export default function FeatureSpotlight({ post }: FeatureSpotlightProps) {
  const locale = useLocale();
  const t = useTranslations('news');
  const category = post.categories?.nodes?.[0];

  return (
    <section className="group overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid items-stretch md:grid-cols-2">
        <Link
          href={`/guides/${post.slug}`}
          className="relative block w-full bg-muted md:h-full md:min-h-[360px]"
          style={{ aspectRatio: '16 / 9' }}
          aria-label={post.title}
        >
          {post.featuredImage?.node ? (
            <Image
              src={getProductionImageUrl(post.featuredImage.node.sourceUrl)}
              alt={post.featuredImage.node.altText || post.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" />
          )}
        </Link>

        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase leading-none tracking-wide text-primary-foreground">
              {t('featuredLabel')}
            </span>
            {category && (
              <Link
                href={`/guides/category/${category.slug}`}
                className="text-xs font-semibold uppercase tracking-wide text-primary hover:text-primary-hover"
              >
                {category.name}
              </Link>
            )}
          </div>
          <h2 className="heading-plain text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight text-foreground">
            <Link href={`/guides/${post.slug}`} className="hover:text-primary transition-colors">
              {post.title}
            </Link>
          </h2>
          {post.excerpt && (
            <div
              className="mt-4 text-muted-foreground line-clamp-3"
              dangerouslySetInnerHTML={{ __html: post.excerpt }}
            />
          )}
          <div className="mt-5 flex items-center gap-4">
            <Link
              href={`/guides/${post.slug}`}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:text-primary-hover"
            >
              {t('readStory')}
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <time dateTime={post.date} className="text-sm text-muted-foreground">
              {formatPostDate(post.date, locale)}
            </time>
          </div>
        </div>
      </div>
    </section>
  );
}
