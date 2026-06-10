'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Post } from '@/lib/types/wordpress';
import { getProductionImageUrl } from '@/lib/utils/image';
import { formatPostDate } from '@/lib/utils/format-post-date';
import ArticleListItem from './ArticleListItem';

interface ArticleHeroProps {
  /** First post is the lead; the rest become the secondary column. */
  posts: Post[];
}

/**
 * Magazine hero: one large lead story with an overlaid headline plus a stacked
 * column of secondary stories. Only the lead image is marked `priority` (LCP).
 */
export default function ArticleHero({ posts }: ArticleHeroProps) {
  const locale = useLocale();
  if (posts.length === 0) return null;

  const [lead, ...rest] = posts;
  const secondary = rest.slice(0, 4);
  const leadCategory = lead.categories?.nodes?.[0];

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
      {/* Lead story — image over text (stacked) on mobile, overlaid on desktop */}
      <article className="lg:col-span-2 group overflow-hidden rounded-xl bg-card lg:relative lg:h-[500px] lg:bg-muted">
        {/* Cover image (clickable). 16:9 block on mobile, full-bleed on desktop.
            The Link is the positioned, definite-height parent so next/image
            `fill` resolves (aspect-ratio on mobile, inset-0 on desktop). */}
        <Link
          href={`/guides/${lead.slug}`}
          aria-label={lead.title}
          className="relative block w-full bg-muted lg:absolute lg:inset-0 lg:h-full"
          style={{ aspectRatio: '16 / 9' }}
        >
          {lead.featuredImage?.node ? (
            <Image
              src={getProductionImageUrl(lead.featuredImage.node.sourceUrl)}
              alt={lead.featuredImage.node.altText || lead.title}
              fill
              priority
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 1024px) 100vw, 66vw"
            />
          ) : (
            <span className="absolute inset-0 bg-gradient-to-br from-muted to-border" />
          )}
          {/* Readability scrim — desktop overlay only */}
          <span className="hidden lg:block absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        </Link>

        {/* Text — below the image on mobile, overlaid at the bottom on desktop */}
        <div className="p-5 sm:p-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:z-20 lg:p-8 lg:pointer-events-none">
          {leadCategory && (
            <Link
              href={`/guides/category/${leadCategory.slug}`}
              className="pointer-events-auto mb-3 inline-block rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground"
            >
              {leadCategory.name}
            </Link>
          )}
          <h2 className="heading-plain text-2xl sm:text-4xl font-extrabold leading-tight text-foreground lg:text-white lg:drop-shadow-sm line-clamp-3 decoration-primary decoration-2 underline-offset-4 group-hover:underline">
            <Link href={`/guides/${lead.slug}`} className="pointer-events-auto">
              {lead.title}
            </Link>
          </h2>
          {lead.excerpt && (
            <div
              className="mt-3 max-w-2xl text-sm text-muted-foreground lg:text-white/85 line-clamp-2"
              dangerouslySetInnerHTML={{ __html: lead.excerpt }}
            />
          )}
          <time dateTime={lead.date} className="mt-3 block text-xs font-medium text-muted-foreground lg:text-white/70">
            {formatPostDate(lead.date, locale)}
          </time>
        </div>
      </article>

      {/* Secondary stories */}
      {secondary.length > 0 && (
        <div className="lg:col-span-1 divide-y divide-border">
          {secondary.map((post) => (
            <ArticleListItem key={post.id} post={post} />
          ))}
        </div>
      )}
    </section>
  );
}
