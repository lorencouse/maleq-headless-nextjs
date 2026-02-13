import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClient } from '@/lib/apollo/client';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import {
  GET_POSTS_BY_TAG,
  GET_TAG_BY_SLUG,
  GET_ALL_TAGS,
} from '@/lib/queries/posts';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import { Post } from '@/lib/types/wordpress';
import { stripHtml } from '@/lib/utils/text-utils';

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

export async function generateMetadata({ params }: BlogTagPageProps): Promise<Metadata> {
  const { slug } = await params;

  const { data } = await getClient().query({
    query: GET_TAG_BY_SLUG,
    variables: { slug },
    fetchPolicy: 'no-cache',
  });

  const tag: Tag | null = data?.tag;

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
  try {
    const { data } = await getClient().query({
      query: GET_ALL_TAGS,
      fetchPolicy: 'no-cache',
    });

    const tags: Tag[] = data?.tags?.nodes || [];

    const params = tags
      .filter((tag) => tag.count > 0)
      .map((tag) => ({
        slug: tag.slug,
      }));

    return limitStaticParams(params, DEV_LIMITS.blogTags);
  } catch (error) {
    console.error('Error generating static params for blog tags:', error);
    return [];
  }
}

// ISR: Revalidate every 1 week for blog content
export const revalidate = 604800;
export const dynamicParams = true; // Allow runtime generation

export default async function BlogTagPage({ params }: BlogTagPageProps) {
  const { slug } = await params;

  // Fetch tag and posts in parallel
  const [tagResult, postsResult] = await Promise.all([
    getClient().query({
      query: GET_TAG_BY_SLUG,
      variables: { slug },
      fetchPolicy: 'no-cache',
    }),
    getClient().query({
      query: GET_POSTS_BY_TAG,
      variables: { tag: slug, first: 12 },
      fetchPolicy: 'no-cache',
    }),
  ]);

  const tag: Tag | null = tagResult.data?.tag;
  const posts: Post[] = postsResult.data?.posts?.nodes || [];
  const pageInfo = postsResult.data?.posts?.pageInfo || {
    hasNextPage: false,
    endCursor: null,
  };

  if (!tag) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      {/* Hero Section */}
      <div className="mb-12">
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
            dangerouslySetInnerHTML={{ __html: tag.description }}
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
