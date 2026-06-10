'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Post } from '@/lib/types/wordpress';

interface NewsTickerProps {
  posts: Post[];
}

/**
 * Thin "latest" strip: newest headlines with relative timestamps. Relative
 * time is computed only after mount (so server and client agree on first
 * paint — "2h ago" can't be rendered identically on both), with the <time>
 * element flagged suppressHydrationWarning as a belt-and-braces guard.
 */
export default function NewsTicker({ posts }: NewsTickerProps) {
  const t = useTranslations('news');
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  if (posts.length === 0) return null;

  const relative = (dateString: string): string => {
    if (now === null) return '';
    const seconds = Math.floor((now - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return t('justNow');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hoursAgo', { count: hours });
    return t('daysAgo', { count: Math.floor(hours / 24) });
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5">
      <span className="flex flex-shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        {t('latestLabel')}
      </span>
      <div className="ticker-mask relative min-w-0 flex-1 overflow-hidden">
        {/* Two identical copies so translateX(-50%) loops seamlessly. The
            second copy is aria-hidden to avoid duplicate links for AT. */}
        <div className="ticker-track flex w-max whitespace-nowrap text-sm">
          {[...posts, ...posts].map((post, i) => (
            <Link
              key={`${post.id}-${i}`}
              href={`/guides/${post.slug}`}
              aria-hidden={i >= posts.length ? true : undefined}
              tabIndex={i >= posts.length ? -1 : undefined}
              className="flex-shrink-0 text-foreground transition-colors hover:text-primary"
              style={{ marginRight: '2.75rem' }}
            >
              {post.title}
              <time
                dateTime={post.date}
                suppressHydrationWarning
                className="text-xs text-muted-foreground"
                style={{ marginLeft: '0.875rem' }}
              >
                {relative(post.date)}
              </time>
            </Link>
          ))}
        </div>
      </div>

      <style jsx>{`
        .ticker-mask {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent,
            black 1.5rem,
            black calc(100% - 1.5rem),
            transparent
          );
          mask-image: linear-gradient(
            to right,
            transparent,
            black 1.5rem,
            black calc(100% - 1.5rem),
            transparent
          );
        }
        .ticker-track {
          animation: ticker-scroll 45s linear infinite;
        }
        .ticker-mask:hover .ticker-track {
          animation-play-state: paused;
        }
        @keyframes ticker-scroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
