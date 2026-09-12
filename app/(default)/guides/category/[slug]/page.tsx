import { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { searchBlogPosts, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import { stripHtml } from '@/lib/utils/text-utils';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { BreadcrumbSchema } from '@/components/seo/StructuredData';
import Pagination from '@/components/shop/Pagination';
import { parsePage, listingCanonical, offsetCursor, totalPagesFor } from '@/lib/seo/listing-params';

const POSTS_PER_PAGE = 12;

interface BlogCategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

async function fetchCategory(slug: string): Promise<Category | null> {
  // Try MySQL first
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadBlogCategoryBySlug } = await import('@/lib/db/blog-loader');
      const cat = await loadBlogCategoryBySlug(slug);
      if (cat) return cat;
    }
  } catch {}

  // GraphQL fallback
  const { getClient, REVALIDATE } = await import('@/lib/apollo/client');
  const { GET_CATEGORY_BY_SLUG } = await import('@/lib/queries/posts');
  const { data } = await getClient().query({
    query: GET_CATEGORY_BY_SLUG,
    variables: { slug },
    revalidate: REVALIDATE.NONE,
  });
  return data?.category || null;
}

export async function generateMetadata({ params, searchParams }: BlogCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = parsePage(await searchParams);
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });
  const tp = await getTranslations({ locale, namespace: 'pagination' });
  const category = await fetchCategory(slug);

  if (!category) {
    return {
      title: t('categoryMetaNotFound'),
    };
  }

  const description = category.description
    ? stripHtml(category.description).slice(0, 160)
    : t('categoryMetaDescription', { name: category.name, count: category.count });

  const baseTitle = t('categoryMetaTitle', { name: category.name });

  return {
    title: page > 1 ? `${baseTitle} – ${tp('page', { page })}` : baseTitle,
    description,
    openGraph: {
      title: t('categoryMetaOgTitle', { name: category.name }),
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: t('categoryMetaOgTitle', { name: category.name }),
      description,
    },
    alternates: {
      canonical: listingCanonical(`/guides/category/${slug}`, page),
    },
  };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Dynamic page: uses searchParams for pagination.
// Data fetching uses unstable_cache, so no perf penalty.
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
// No generateStaticParams: with force-dynamic nothing is prerendered, so
// enumerating categories at build time was pure wasted work on the build host.

export default async function BlogCategoryPage({ params, searchParams }: BlogCategoryPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { q: searchQuery } = sp;
  const page = parsePage(sp);
  const offset = (page - 1) * POSTS_PER_PAGE;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'blog' });

  const category = await fetchCategory(slug);

  if (!category) {
    notFound();
  }

  // Fetch posts (with search if provided)
  const { posts, pageInfo } = searchQuery
    ? await searchBlogPosts(searchQuery, { first: 20, categorySlug: slug })
    : await getBlogPosts({ first: POSTS_PER_PAGE, after: offsetCursor(offset), categorySlug: slug });

  // A page past the end is a real 404, not an empty 200 (soft-404).
  if (page > 1 && posts.length === 0) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      {/* Hero Section */}
      <div className="mb-8">
        {/* Breadcrumb Schema */}
        <BreadcrumbSchema
          items={[
            { name: t('breadcrumbHome'), url: SITE_URL },
            { name: t('breadcrumbGuides'), url: `${SITE_URL}/guides` },
            { name: t('categoryBreadcrumbSchemaName'), url: `${SITE_URL}/guides/category` },
            { name: category.name, url: `${SITE_URL}/guides/category/${slug}` },
          ]}
        />

        {/* Breadcrumb */}
        <Breadcrumbs
          items={[
            { label: t('breadcrumbBlog'), href: '/guides' },
            { label: category.name },
          ]}
        />

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mt-4">
          <div>
            {/* Title */}
            <h1 className="text-4xl font-bold text-foreground">{category.name}</h1>

            {/* Description */}
            {category.description && (
              <p
                className="text-lg text-muted-foreground max-w-2xl mt-2"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(category.description) }}
              />
            )}

            {/* Post count / search results */}
            <p className="text-sm text-muted-foreground mt-2">
              {searchQuery
                ? posts.length === 0
                  ? t('searchNoResults', { query: searchQuery })
                  : t('searchResultsCount', { count: posts.length, query: searchQuery })
                : t('categoryArticleCount', { count: category.count })}
            </p>
          </div>

          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <BlogSearch />
          </Suspense>
        </div>
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: !searchQuery && pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
        categorySlug={slug}
      />

      {/* Crawlable ?page=N links for the archive */}
      {!searchQuery && (
        <Pagination
          currentPage={page}
          totalPages={totalPagesFor(category.count, POSTS_PER_PAGE)}
          hasNextPage={pageInfo.hasNextPage}
          basePath={`/guides/category/${slug}`}
        />
      )}

      {/* Back to blog */}
      <div className="mt-12 pt-8 border-t border-border">
        <Link
          href="/guides"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t('backToAllArticles')}
        </Link>
      </div>
    </div>
  );
}
