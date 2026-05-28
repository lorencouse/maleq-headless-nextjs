import { notFound, permanentRedirect } from 'next/navigation';
import { getClient } from '@/lib/apollo/client';
import { GET_POST_BY_SLUG } from '@/lib/queries/posts';

interface LegacyRootSlugPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

async function blogPostExists(slug: string): Promise<boolean> {
  if (!slug) return false;

  // Slugs with dot-extensions are usually legacy artifacts/files, not posts.
  if (slug.includes('.')) return false;

  // MySQL-first for performance; GraphQL fallback.
  if (process.env.DATA_SOURCE !== 'graphql') {
    try {
      const { isMySQLReachable } = await import('@/lib/db/pool');
      if (await isMySQLReachable()) {
        const { loadPostBySlug } = await import('@/lib/db/blog-loader');
        const post = await loadPostBySlug(slug);
        if (post) return true;
      }
    } catch {}
  }

  try {
    const { REVALIDATE } = await import('@/lib/apollo/client');
    const { data } = await getClient().query({
      query: GET_POST_BY_SLUG,
      variables: { slug },
      revalidate: REVALIDATE.NONE,
    });
    return Boolean(data?.postBy);
  } catch {
    return false;
  }
}

export default async function LegacyRootSlugPage({ params }: LegacyRootSlugPageProps) {
  const { slug } = await params;

  if (await blogPostExists(slug)) {
    permanentRedirect(`/guides/${slug}`);
  }

  notFound();
}
