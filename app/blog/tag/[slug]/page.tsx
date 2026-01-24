import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClient } from '@/lib/apollo/client';
import {
  GET_POSTS_BY_TAG,
  GET_TAG_BY_SLUG,
  GET_ALL_TAGS,
} from '@/lib/queries/posts';
import BlogCard from '@/components/blog/BlogCard';
import { Post } from '@/lib/types/wordpress';

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
  });

  const tag: Tag | null = data?.tag;

  if (!tag) {
    return {
      title: 'Tag Not Found | Male Q Blog',
    };
  }

  const description = tag.description
    ? tag.description.replace(/<[^>]*>/g, '').slice(0, 160)
    : `Browse articles tagged with "${tag.name}" on the Male Q blog. ${tag.count} posts available.`;

  return {
    title: `${tag.name} | Male Q Blog`,
    description,
    openGraph: {
      title: `${tag.name} | Male Q Blog`,
      description,
      type: 'website',
    },
  };
}

export async function generateStaticParams() {
  const { data } = await getClient().query({
    query: GET_ALL_TAGS,
  });

  const tags: Tag[] = data?.tags?.nodes || [];

  return tags
    .filter((tag) => tag.count > 0)
    .map((tag) => ({
      slug: tag.slug,
    }));
}

export const dynamic = 'force-dynamic';

export default async function BlogTagPage({ params }: BlogTagPageProps) {
  const { slug } = await params;

  // Fetch tag and posts in parallel
  const [tagResult, postsResult] = await Promise.all([
    getClient().query({
      query: GET_TAG_BY_SLUG,
      variables: { slug },
    }),
    getClient().query({
      query: GET_POSTS_BY_TAG,
      variables: { tag: slug, first: 24 },
    }),
  ]);

  const tag: Tag | null = tagResult.data?.tag;
  const posts: Post[] = postsResult.data?.posts?.nodes || [];
  const pageInfo = postsResult.data?.posts?.pageInfo;

  if (!tag) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="mb-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/blog" className="hover:text-foreground transition-colors">
            Blog
          </Link>
          <span>/</span>
          <span className="text-foreground">Tag: {tag.name}</span>
        </div>

        {/* Title with tag icon */}
        <div className="flex items-center gap-3 mb-4">
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
          {posts.length} {posts.length === 1 ? 'article' : 'articles'} tagged with "{tag.name}"
        </p>
      </div>

      {/* Posts Grid */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">No articles yet</h2>
          <p className="text-muted-foreground mb-6">
            There are no articles with this tag yet. Check back soon!
          </p>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
          >
            Browse All Articles
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </Link>
        </div>
      )}

      {/* Pagination placeholder */}
      {pageInfo?.hasNextPage && (
        <div className="mt-12 text-center">
          <button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium">
            Load More Articles
          </button>
        </div>
      )}

      {/* Back to blog */}
      <div className="mt-12 pt-8 border-t border-border">
        <Link
          href="/blog"
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
