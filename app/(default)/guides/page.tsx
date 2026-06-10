import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { searchBlogPosts, getBlogPosts, getGuidesLanding } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import ArticleHero from '@/components/blog/ArticleHero';
import TopicSection, { TopicLayout } from '@/components/blog/TopicSection';
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

// Dynamic page: reads searchParams for blog search. Landing data comes from
// SQL loaders with a 5-min cache, so the magazine view stays cheap.

interface BlogPageProps {
  searchParams: Promise<{ q?: string }>;
}

// Cycle layouts so the page reads with news-site variety.
const SECTION_LAYOUTS: TopicLayout[] = ['carousel', 'grid', 'list', 'carousel', 'grid', 'carousel'];

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { q: searchQuery } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });

  // ─── Search view (unchanged behavior) ───
  if (searchQuery) {
    const { posts, pageInfo, suggestions } = await searchBlogPosts(searchQuery, { first: 20 });
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
        <Breadcrumbs items={[{ label: t('breadcrumbGuides') }]} />
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <h1 className="text-4xl font-bold text-foreground">{t('pageTitle')}</h1>
            <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
              <BlogSearch />
            </Suspense>
          </div>
          {suggestions && posts.length === 0 && (
            <DidYouMean suggestions={suggestions} basePath="/guides" />
          )}
          <p className="text-sm text-muted-foreground">
            {posts.length === 0
              ? t('searchNoResults', { query: searchQuery })
              : t('searchResultsCount', { count: posts.length, query: searchQuery })}
          </p>
        </div>
        <BlogPostsGrid
          initialPosts={posts}
          initialPageInfo={{ hasNextPage: false, endCursor: pageInfo.endCursor }}
        />
      </div>
    );
  }

  // ─── Magazine view ───
  const [{ hero, sections }, tail] = await Promise.all([
    getGuidesLanding(),
    getBlogPosts({ first: 12, excludeCategorySlugs: ['espanol', 'cn'] }),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      <Breadcrumbs items={[{ label: t('breadcrumbGuides') }]} />

      {/* Search + language links — langs right of search on desktop, above on mobile */}
      <div className="mt-2 mb-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
          <BlogSearch />
        </Suspense>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{t('alsoAvailableIn')}</span>
          <Link href="/guides/category/espanol" className="text-sm font-medium text-primary hover:text-primary-hover transition-colors">
            Espa&ntilde;ol
          </Link>
          <Link href="/guides/category/cn" className="text-sm font-medium text-primary hover:text-primary-hover transition-colors">
            &#20013;&#25991;
          </Link>
        </div>
      </div>

      {/* Hero */}
      {hero.length > 0 && <ArticleHero posts={hero} />}

      {/* Header */}
      <div className="mt-10 lg:mt-12 mb-8">
        <h1 className="text-4xl font-bold text-foreground mb-1">{t('pageTitle')}</h1>
        <p className="text-lg text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      {/* Topic sections */}
      <div className="mt-12 lg:mt-16 space-y-12 lg:space-y-16">
        {sections.map((section, i) => (
          <TopicSection
            key={section.slug}
            title={section.name}
            posts={section.posts}
            viewAllLink={`/guides/category/${section.slug}`}
            layout={SECTION_LAYOUTS[i % SECTION_LAYOUTS.length]}
          />
        ))}
      </div>

      {/* More stories (infinite scroll) */}
      <div className="mt-12 lg:mt-16 border-t border-border pt-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground pl-3 border-l-4 border-primary mb-6">
          {t('moreStoriesHeading')}
        </h2>
        <BlogPostsGrid
          initialPosts={tail.posts}
          initialPageInfo={{ hasNextPage: tail.pageInfo.hasNextPage, endCursor: tail.pageInfo.endCursor }}
          excludeCategories="espanol,cn"
        />
      </div>
    </div>
  );
}
