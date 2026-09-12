import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { searchBlogPosts, getBlogPosts, getGuidesLanding } from '@/lib/blog/blog-service';
import SectionHeader from '@/components/ui/SectionHeader';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import ArticleHero from '@/components/blog/ArticleHero';
import TopicSection, { TopicLayout } from '@/components/blog/TopicSection';
import DidYouMean from '@/components/search/DidYouMean';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import Pagination from '@/components/shop/Pagination';
import { notFound } from 'next/navigation';
import { parsePage, listingCanonical, offsetCursor } from '@/lib/seo/listing-params';

const POSTS_PER_PAGE = 12;

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const sp = await searchParams;
  const { q: searchQuery } = sp;
  const page = parsePage(sp);
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });
  const tp = await getTranslations({ locale, namespace: 'pagination' });

  if (searchQuery) {
    return {
      title: t('metaSearchTitle', { query: searchQuery }),
      description: t('metaSearchDescription', { query: searchQuery }),
      robots: { index: false },
    };
  }

  return {
    title: page > 1 ? `${t('metaTitle')} – ${tp('page', { page })}` : t('metaTitle'),
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
      canonical: listingCanonical('/guides', page),
    },
  };
}

// Dynamic page: reads searchParams for blog search. Landing data comes from
// SQL loaders with a 5-min cache, so the magazine view stays cheap.

interface BlogPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

// Cycle layouts so the page reads with news-site variety.
const SECTION_LAYOUTS: TopicLayout[] = ['carousel', 'grid', 'list', 'carousel', 'grid', 'carousel'];

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const sp = await searchParams;
  const { q: searchQuery } = sp;
  const page = parsePage(sp);
  const offset = (page - 1) * POSTS_PER_PAGE;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });
  const tp = await getTranslations({ locale, namespace: 'pagination' });

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

  // ─── Archive pages (?page=2+) ───
  // Plain chronological list with real prev/next links, so every guide is
  // reachable by crawlers without the JS load-more (SEO audit finding C3).
  if (page > 1) {
    const archive = await getBlogPosts({
      first: POSTS_PER_PAGE,
      after: offsetCursor(offset),
      excludeCategorySlugs: ['espanol', 'cn'],
    });
    if (archive.posts.length === 0) {
      notFound();
    }
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
        <Breadcrumbs items={[{ label: t('breadcrumbGuides'), href: '/guides' }, { label: tp('page', { page }) }]} />
        <div className="mt-6 mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-1">{t('pageTitle')}</h1>
          <p className="text-lg text-muted-foreground">
            {t('moreStoriesHeading')} · {tp('page', { page })}
          </p>
        </div>
        <BlogPostsGrid
          initialPosts={archive.posts}
          initialPageInfo={{ hasNextPage: archive.pageInfo.hasNextPage, endCursor: archive.pageInfo.endCursor }}
          excludeCategories="espanol,cn"
        />
        <Pagination currentPage={page} hasNextPage={archive.pageInfo.hasNextPage} basePath="/guides" />
      </div>
    );
  }

  // ─── Magazine view ───
  const [{ hero, sections }, tail] = await Promise.all([
    getGuidesLanding(),
    getBlogPosts({ first: POSTS_PER_PAGE, excludeCategorySlugs: ['espanol', 'cn'] }),
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
        <SectionHeader title={t('moreStoriesHeading')} />
        <BlogPostsGrid
          initialPosts={tail.posts}
          initialPageInfo={{ hasNextPage: tail.pageInfo.hasNextPage, endCursor: tail.pageInfo.endCursor }}
          excludeCategories="espanol,cn"
        />
        <Pagination currentPage={1} hasNextPage={tail.pageInfo.hasNextPage} basePath="/guides" />
      </div>
    </div>
  );
}
