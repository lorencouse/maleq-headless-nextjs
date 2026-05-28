import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import DidYouMean from '@/components/search/DidYouMean';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const { q: searchQuery } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });

  if (searchQuery) {
    return {
      title: t('metaSearchTitle', { query: searchQuery }),
      description: t('metaSearchDescription', { query: searchQuery }),
      robots: { index: false },
    };
  }

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    openGraph: {
      title: t('metaOgTitle'),
      description: t('metaDescriptionShort'),
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: t('metaOgTitle'),
      description: t('metaDescriptionShort'),
    },
    alternates: {
      canonical: '/guides',
    },
  };
}

// Dynamic page: uses searchParams for blog search.
// Data fetching uses unstable_cache, so no perf penalty.

interface BlogPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { q: searchQuery } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });

  // Use search if provided, otherwise get EN-only posts (exclude Spanish/Chinese)
  const result = searchQuery
    ? await searchBlogPosts(searchQuery, { first: 20 })
    : await getBlogPosts({ first: 12, excludeCategorySlugs: ['espanol', 'cn'] });

  const { posts, pageInfo, suggestions } = result;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      <Breadcrumbs items={[{ label: t('breadcrumbGuides') }]} />

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">{t('pageTitle')}</h1>
            <p className="text-lg text-muted-foreground">
              {t('pageSubtitle')}
            </p>
            {/* Language category links */}
            {!searchQuery && (
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm text-muted-foreground">{t('alsoAvailableIn')}</span>
                <Link
                  href="/guides/category/espanol"
                  className="text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                >
                  Espa&ntilde;ol
                </Link>
                <Link
                  href="/guides/category/cn"
                  className="text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                >
                  &#20013;&#25991;
                </Link>
              </div>
            )}
          </div>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <BlogSearch />
          </Suspense>
        </div>

        {/* Did you mean? suggestions when no results */}
        {suggestions && searchQuery && posts.length === 0 && (
          <DidYouMean suggestions={suggestions} basePath="/guides" />
        )}

        {/* Search results indicator */}
        {searchQuery && (
          <p className="text-sm text-muted-foreground">
            {posts.length === 0
              ? t('searchNoResults', { query: searchQuery })
              : t('searchResultsCount', { count: posts.length, query: searchQuery })}
          </p>
        )}
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: !searchQuery && pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
        excludeCategories={searchQuery ? undefined : 'espanol,cn'}
      />
    </div>
  );
}
