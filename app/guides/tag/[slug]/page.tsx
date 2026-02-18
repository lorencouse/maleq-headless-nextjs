import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import { getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import { stripHtml } from '@/lib/utils/text-utils';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { BreadcrumbSchema } from '@/components/seo/StructuredData';

interface BlogTagPageProps {
  params: Promise<{ slug: string }>;
}

interface Tag {
  id: string;
  name: string;
  slug: string;
  count: number;
  description?: string | null;
}

async function fetchTag(slug: string): Promise<Tag | null> {
  // Try MySQL first
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadBlogTagBySlug } = await import('@/lib/db/blog-loader');
      const tag = await loadBlogTagBySlug(slug);
      if (tag) return tag;
    }
  } catch {}

  // GraphQL fallback
  const { getClient } = await import('@/lib/apollo/client');
  const { GET_TAG_BY_SLUG } = await import('@/lib/queries/posts');
  const { data } = await getClient().query({
    query: GET_TAG_BY_SLUG,
    variables: { slug },
  });
  return data?.tag || null;
}

export async function generateMetadata({ params }: BlogTagPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = await fetchTag(slug);

  if (!tag) {
    return {
      title: 'Tag Not Found | Guides',
    };
  }

  const description = tag.description
    ? stripHtml(tag.description).slice(0, 160)
    : `Browse articles tagged with "${tag.name}" on the Male Q blog. ${tag.count} posts available.`;

  return {
    title: `${tag.name} | Guides`,
    description,
    openGraph: {
      title: `${tag.name} | Male Q Guides`,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${tag.name} | Male Q Guides`,
      description,
    },
    alternates: {
      canonical: `/guides/tag/${slug}`,
    },
  };
}

export async function generateStaticParams() {
  // Try MySQL first
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadBlogTags } = await import('@/lib/db/blog-loader');
      const tags = await loadBlogTags();
      const params = tags
        .filter(tag => tag.count > 0)
        .map(tag => ({ slug: tag.slug }));
      return limitStaticParams(params, DEV_LIMITS.blogTags);
    }
  } catch {}

  // GraphQL fallback
  try {
    const { getClient } = await import('@/lib/apollo/client');
    const { GET_ALL_TAGS } = await import('@/lib/queries/posts');
    const { data } = await getClient().query({ query: GET_ALL_TAGS });
    const tags: Tag[] = data?.tags?.nodes || [];
    const params = tags
      .filter(tag => tag.count > 0)
      .map(tag => ({ slug: tag.slug }));
    return limitStaticParams(params, DEV_LIMITS.blogTags);
  } catch (error) {
    console.error('Error generating static params for blog tags:', error);
    return [];
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// ISR: Revalidate monthly — webhook handles real-time invalidation on post updates
export const revalidate = 2592000;
export const dynamicParams = true; // Allow runtime generation

export default async function BlogTagPage({ params }: BlogTagPageProps) {
  const { slug } = await params;

  // Fetch tag and posts in parallel
  const [tag, postsResult] = await Promise.all([
    fetchTag(slug),
    getBlogPosts({ first: 12, tagSlug: slug }),
  ]);

  const posts = postsResult.posts;
  const pageInfo = postsResult.pageInfo;

  if (!tag) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      {/* Hero Section */}
      <div className="mb-12">
        {/* Breadcrumb Schema */}
        <BreadcrumbSchema
          items={[
            { name: 'Home', url: SITE_URL },
            { name: 'Guides', url: `${SITE_URL}/guides` },
            { name: 'Tag', url: `${SITE_URL}/guides/tag` },
            { name: tag.name, url: `${SITE_URL}/guides/tag/${slug}` },
          ]}
        />

        {/* Breadcrumb */}
        <Breadcrumbs
          items={[
            { label: 'Blog', href: '/guides' },
            { label: tag.name },
          ]}
        />

        {/* Title with tag icon */}
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </span>
          <h1 className="text-4xl font-bold text-foreground">{tag.name}</h1>
        </div>

        {/* Description */}
        {tag.description && (
          <p
            className="text-lg text-muted-foreground max-w-2xl mb-4"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(tag.description) }}
          />
        )}

        {/* Post count */}
        <p className="text-sm text-muted-foreground">
          {tag.count} {tag.count === 1 ? 'article' : 'articles'} tagged with "{tag.name}"
        </p>
      </div>

      {/* Posts Grid with Load More */}
      <BlogPostsGrid
        initialPosts={posts}
        initialPageInfo={{
          hasNextPage: pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        }}
        tagSlug={slug}
      />

      {/* Back to blog */}
      <div className="mt-12 pt-8 border-t border-border">
        <Link
          href="/guides"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to all articles
        </Link>
      </div>
    </div>
  );
}
