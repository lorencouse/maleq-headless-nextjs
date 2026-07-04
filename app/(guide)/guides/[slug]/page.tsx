import { Metadata } from 'next';
import { cache } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClient } from '@/lib/apollo/client';
import { loadPostBySlug } from '@/lib/db/blog-loader';
import { renderPostContentFromSql, expandReferences } from '@/lib/db/gutenberg-render';
import {
  GET_POST_BY_SLUG,
  GET_ALL_POST_SLUGS,
  GET_RELATED_POSTS,
} from '@/lib/queries/posts';
import RelatedPosts from '@/components/blog/RelatedPosts';
import CommentForm from '@/components/blog/CommentForm';
import { limitStaticParams, DEV_LIMITS, shouldLimitParams } from '@/lib/utils/static-params';
import { formatPostDate } from '@/lib/utils/format-post-date';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Post } from '@/lib/types/wordpress';
import {
  getProductionImageUrl,
  rewriteWordPressUrls,
} from '@/lib/utils/image';
import { sanitizeHtml, sanitizeComment } from '@/lib/utils/sanitize';
import {
  extractProductIdsFromContent,
  fetchProductsByIds,
  productMapToObject,
} from '@/lib/utils/blog-products';
import VideoAutoplay from '@/components/blog/VideoAutoplay';
import StarRatingEnhancer from '@/components/blog/StarRatingEnhancer';
import CheckmarkEnhancer from '@/components/blog/CheckmarkEnhancer';
import AddToCartEnhancer from '@/components/blog/AddToCartEnhancer';
import RecommendedProducts from '@/components/blog/RecommendedProducts';
import BuyersGuide from '@/components/blog/buyers-guide/BuyersGuide';
import LanguageSwitcher from '@/components/blog/LanguageSwitcher';
import SocialShare from '@/components/product/SocialShare';
import { loadPostRecommendations, loadGuide, type ResolvedGuide } from '@/lib/db/post-relations';
import { loadPostTranslations, type PostTranslation } from '@/lib/db/post-translations';
import { getGuideLocaleBySlug } from '@/lib/db/guide-locale';
import { toWpPostName } from '@/lib/utils/wp-slug';
import {
  detectGuideLocale,
  getGuideLanguage,
  DEFAULT_GUIDE_LOCALE,
  staticRequestLocale,
} from '@/lib/i18n/guide-languages';
import DevEditLink from '@/components/dev/DevEditLink';
import { getWpBaseUrl } from '@/lib/db/wp-url';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { ArticleSchema, BreadcrumbSchema } from '@/components/seo/StructuredData';
import { stripHtml } from '@/lib/utils/text-utils';
import TableOfContents from '@/components/blog/TableOfContents';
import './blog-post.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

/**
 * For roundup ("Best [X]") guides, decide where the programmatic <BuyersGuide>
 * block sits within the prose. Editors place a `[buyers_guide]` marker (it stays
 * literal in the HTML since it's not a registered shortcode, optionally wrapped
 * in its own <p>). Falls back to right after the first <h2> (the intro), then to
 * the very top. The list itself is never authored in Gutenberg — only its
 * position. See docs/BUYERS_GUIDE_SYSTEM.md.
 */
function splitGuideContent(html: string): { before: string; after: string } {
  const marker = /(?:<p>\s*)?\[buyers_guide\](?:\s*<\/p>)?/i;
  const m = marker.exec(html);
  if (m) {
    return { before: html.slice(0, m.index), after: html.slice(m.index + m[0].length) };
  }
  const h2 = /<\/h2>/i.exec(html);
  if (h2) {
    const cut = h2.index + h2[0].length;
    return { before: html.slice(0, cut), after: html.slice(cut) };
  }
  return { before: '', after: html };
}

// Open Graph locale tags per guide language (zh = Traditional / Taiwan).
const OG_LOCALE: Record<string, string> = {
  en: 'en_US',
  es: 'es_ES',
  'zh-hant': 'zh_TW',
  ja: 'ja_JP',
};

/**
 * Editor-curated guide translations (other-language versions of this post),
 * read via SQL. Guarded the same way as the recommendations block; returns []
 * when MySQL is unavailable so the page still renders.
 */
async function loadGuideTranslations(post: Post): Promise<PostTranslation[]> {
  try {
    const { isMySQLConfigured } = await import('@/lib/db/pool');
    if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
      return await loadPostTranslations(post.databaseId);
    }
  } catch {}
  return [];
}

/**
 * Build the hreflang `alternates.languages` map for a guide and its
 * translations (self + each translation + an x-default pointing at English).
 * Returns undefined when the post has no linked translations.
 */
function buildHreflangAlternates(
  post: Post,
  translations: PostTranslation[],
  slug: string,
): Record<string, string> | undefined {
  if (translations.length === 0) return undefined;

  const currentLocale = detectGuideLocale(
    (post.categories?.nodes ?? []).map((n) => n.slug),
  );

  const languages: Record<string, string> = {};

  // This page (self-referencing hreflang).
  if (currentLocale) {
    const lang = getGuideLanguage(currentLocale);
    if (lang) languages[lang.hreflang] = `${SITE_URL}/guides/${slug}`;
  }

  // Each linked translation.
  for (const t of translations) {
    languages[t.hreflang] = `${SITE_URL}/guides/${t.slug}`;
  }

  // x-default → the English version (this page if it's English, else the
  // linked English translation).
  if (currentLocale === DEFAULT_GUIDE_LOCALE) {
    languages['x-default'] = `${SITE_URL}/guides/${slug}`;
  } else {
    const en = translations.find((t) => t.locale === DEFAULT_GUIDE_LOCALE);
    if (en) languages['x-default'] = `${SITE_URL}/guides/${en.slug}`;
  }

  return languages;
}

// ISR: Revalidate monthly — webhook handles real-time invalidation on post updates
export const revalidate = 2592000;
export const dynamicParams = true; // Allow runtime generation of any blog post

/**
 * Load a guide post with FULLY RENDERED content.
 *
 * SQL-first (project rule): the post body is rendered from SQL — reusable
 * blocks + the pros-cons template part expanded, [add_to_cart] shortcodes
 * resolved (incl. sku=), static block comments stripped. This is DETERMINISTIC,
 * unlike WPGraphQL's `content` field whose do_blocks pipeline intermittently
 * returned the raw, un-rendered editor source (reusable blocks left as bare
 * comments) — the root cause of add-to-cart buttons vanishing on some renders.
 *
 * GraphQL `do_blocks` is used only as a LAST RESORT — when the post contains a
 * genuinely dynamic block we can't safely flatten (wp:latest-posts, embeds,
 * Rank Math blocks, …). That's ~27% of posts, all editorial/news with no
 * add-to-cart. Even then we self-heal any un-expanded reusable-block refs via
 * SQL so a transient bad WPGraphQL response can't strand the buttons.
 *
 * cache() dedupes the work across generateMetadata + the page in one request.
 */
const getGuidePost = cache(async (slug: string): Promise<Post | null> => {
  try {
    const { isMySQLConfigured } = await import('@/lib/db/pool');
    if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
      const post = await loadPostBySlug(slug);
      if (post) {
        const { html, needsFallback } = await renderPostContentFromSql(post.content);
        if (!needsFallback) {
          post.content = html;
          return post;
        }
        // Dynamic block present → defer this post to GraphQL do_blocks below.
      }
    }
  } catch (err) {
    console.error('getGuidePost: SQL render path failed, falling back to GraphQL', err);
  }

  const { REVALIDATE } = await import('@/lib/apollo/client');
  const { data } = await getClient().query({
    query: GET_POST_BY_SLUG,
    variables: { slug },
    // Monthly, matching this route's `export const revalidate`. Next uses the
    // LOWEST revalidate across segment config + fetches, so a short TTL here
    // would make the page revalidate that often. Webhook handles real-time.
    revalidate: REVALIDATE.MONTH,
  });
  const post: Post | null = data?.postBy ?? null;

  // Self-heal: if WPGraphQL returned un-expanded reusable-block / template-part
  // references, expand them from SQL so add-to-cart shortcodes still surface.
  if (post?.content && (post.content.includes('wp:block') || post.content.includes('wp:template-part'))) {
    try {
      post.content = await expandReferences(post.content);
    } catch {
      /* leave content as-is on repair failure */
    }
  }

  return post;
});

// Generate metadata for blog post
export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug: slugParam } = await params;
  // Normalize to WP's stored post_name (lowercase percent-encoding) so CJK
  // guide slugs resolve — Next hands us the uppercase-encoded form.
  const slug = toWpPostName(slugParam);
  // Resolve the UI locale from the guide's own language category (en/es/zh/ja),
  // ISR-safe (slug-derived). setRequestLocale opts this page into STATIC
  // rendering (else next-intl reads headers() → DYNAMIC_SERVER_USAGE → 500 on
  // ISR); it's seeded with a routing-safe locale, while the real guide language
  // is applied via the explicit getTranslations({locale}) calls below.
  const locale = await getGuideLocaleBySlug(slug);
  setRequestLocale(staticRequestLocale(locale));
  const t = await getTranslations({ locale, namespace: 'blog' });

  const post = await getGuidePost(slug);

  if (!post) {
    return {
      title: t('metaNotFound'),
    };
  }

  // hreflang alternates for this guide's other-language versions (SEO).
  const translations = await loadGuideTranslations(post);
  const languages = buildHreflangAlternates(post, translations, slug);

  // Strip HTML and limit description
  const description = post.excerpt
    ? stripHtml(post.excerpt).slice(0, 160)
    : post.content
      ? stripHtml(post.content).slice(0, 160)
      : t('metaPostFallbackDescription', { title: post.title });

  return {
    title: t('metaPostTitle', { title: post.title }),
    description,
    openGraph: {
      title: post.title,
      description,
      url: `${SITE_URL}/guides/${slug}`,
      type: 'article',
      locale: OG_LOCALE[locale] ?? OG_LOCALE.en,
      alternateLocale: translations
        .map((tr) => OG_LOCALE[tr.locale])
        .filter((l): l is string => Boolean(l)),
      publishedTime: post.date,
      authors: post.author?.node?.name ? [post.author.node.name] : undefined,
      images: post.featuredImage?.node?.sourceUrl
        ? [
            {
              url: getProductionImageUrl(post.featuredImage.node.sourceUrl),
              width: 1200,
              height: 630,
              alt: post.featuredImage.node.altText || post.title,
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: post.featuredImage?.node?.sourceUrl
        ? [getProductionImageUrl(post.featuredImage.node.sourceUrl)]
        : [],
    },
    alternates: {
      canonical: `${SITE_URL}/guides/${slug}`,
      ...(languages ? { languages } : {}),
    },
  };
}

// Generate static params for all posts (paginated)
export async function generateStaticParams() {
  // Skip before querying anything when static generation is disabled
  if (shouldLimitParams()) return [];
  // Try MySQL first (single query, no pagination loop)
  try {
    const { isMySQLReachable } = await import('@/lib/db/pool');
    if (await isMySQLReachable()) {
      const { loadAllPostSlugs } = await import('@/lib/db/blog-loader');
      const slugs = await loadAllPostSlugs();
      if (slugs.length > 0) {
        return limitStaticParams(slugs.map((slug) => ({ slug })), DEV_LIMITS.blogPosts);
      }
    }
  } catch {}

  // GraphQL fallback with pagination
  const allParams: { slug: string }[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: { data: Record<string, any> } = await getClient().query({
        query: GET_ALL_POST_SLUGS,
        variables: { first: 100, after },
          });

      const nodes: { slug: string }[] = result.data?.posts?.nodes || [];
      allParams.push(...nodes.map((post) => ({ slug: post.slug })));

      hasNextPage = result.data?.posts?.pageInfo?.hasNextPage ?? false;
      after = result.data?.posts?.pageInfo?.endCursor ?? null;
    } catch (error) {
      console.error('Error generating static params for blog posts:', error);
      break;
    }
  }

  return limitStaticParams(allParams, DEV_LIMITS.blogPosts);
}

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug: slugParam } = await params;
  // Normalize to WP's stored post_name (lowercase percent-encoding) so CJK
  // guide slugs resolve — see generateMetadata / lib/utils/wp-slug.
  const slug = toWpPostName(slugParam);
  // See generateMetadata above: resolve the UI locale from the guide's own
  // language category. setRequestLocale opts this page into STATIC rendering
  // (else next-intl reads headers() → DYNAMIC_SERVER_USAGE → 500 on ISR);
  // seeded with a routing-safe locale, real language via explicit getTranslations.
  const locale = await getGuideLocaleBySlug(slug);
  setRequestLocale(staticRequestLocale(locale));
  const t = await getTranslations({ locale, namespace: 'blog' });
  const tNews = await getTranslations({ locale, namespace: 'news' });

  // SQL-first content render (deterministic), GraphQL do_blocks only as a
  // last resort for posts with dynamic blocks. See getGuidePost above.
  const post = await getGuidePost(slug);

  if (!post) {
    notFound();
  }

  // News articles live under /guides/[slug] but belong to the /news section —
  // give them a "Home › News › Title" trail instead of the guides taxonomy trail.
  const isNews = post.categories?.nodes?.some((n) => n.slug === 'news') ?? false;

  // Fetch related posts from the same category
  let relatedPosts: Post[] = [];
  if (post.categories?.nodes && post.categories.nodes.length > 0) {
    const categorySlug = post.categories.nodes[0].slug;
    // Try MySQL first
    let usedSQL = false;
    try {
      const { isMySQLConfigured } = await import('@/lib/db/pool');
      if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
        const { loadBlogPosts } = await import('@/lib/db/blog-loader');
        const result = await loadBlogPosts({ categorySlug, first: 10 });
        relatedPosts = result.posts;
        usedSQL = true;
      }
    } catch {}

    if (!usedSQL) {
      const { data: relatedData } = await getClient().query({
        query: GET_RELATED_POSTS,
        variables: { categorySlug, first: 10 },
      });
      relatedPosts = relatedData?.posts?.nodes || [];
    }
  }

  // BlogCard (the only consumer) renders title/excerpt/image/meta — never the
  // body. Drop the heavy raw post_content here so it isn't serialized into the
  // RSC flight payload of every guide page (it was adding ~tens of KB of
  // un-rendered Gutenberg source per page).
  relatedPosts = relatedPosts.map((p) => (p.content ? { ...p, content: '' } : p));

  // Extract and batch fetch products from WooCommerce shortcodes in content
  const productIds = extractProductIdsFromContent(post.content);
  const productMap = await fetchProductsByIds(productIds);
  const blogProducts = productMapToObject(productMap);

  // Editor-curated product relations (meta-box driven), independent of the
  // inline shortcodes above. Surfaced as a "Recommended Products" block.
  let recommendations: Awaited<ReturnType<typeof loadPostRecommendations>> = {
    products: [],
    categories: [],
  };
  try {
    const { isMySQLConfigured } = await import('@/lib/db/pool');
    if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
      recommendations = await loadPostRecommendations(post.databaseId);
    }
  } catch {}

  // Roundup ("Best [X]") guide data — type:null for normal articles (no-op).
  let guide: ResolvedGuide = { type: null, entries: [], faq: [], columns: [], meta: {} };
  try {
    const { isMySQLConfigured } = await import('@/lib/db/pool');
    if (isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql') {
      guide = await loadGuide(post.databaseId);
    }
  } catch {}
  const isRoundup = guide.type === 'roundup';

  // Sanitize + URL-rewrite once; for roundups, split the prose around the
  // programmatic <BuyersGuide> block (intro before, conclusion/advice after).
  const contentHtml = sanitizeHtml(rewriteWordPressUrls(post.content));
  const { before: introHtml, after: outroHtml } = isRoundup
    ? splitGuideContent(contentHtml)
    : { before: contentHtml, after: '' };

  // Other-language versions of this guide (meta-box driven), for the switcher.
  const translations = await loadGuideTranslations(post);

  // Use the shared UTC-pinned formatter (covers all locales incl. de/fr/zh).
  // The inline map this replaced was missing locales, so de/fr/zh fell back to
  // the runtime default locale — a hydration-mismatch risk (React #418) that
  // strands the client-side add-to-cart enhancer (buttons vanish on some posts).
  const formatDate = (dateString: string) => formatPostDate(dateString, locale);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex gap-8">
        {/* Main Content */}
        <article className='single-post flex-1 min-w-0 max-w-4xl'>
      {/* Blog Post Structured Data */}
      <ArticleSchema
        headline={post.title}
        description={
          post.excerpt
            ? stripHtml(post.excerpt).slice(0, 160)
            : stripHtml(post.content).slice(0, 160)
        }
        image={
          post.featuredImage?.node?.sourceUrl
            ? getProductionImageUrl(post.featuredImage.node.sourceUrl)
            : undefined
        }
        datePublished={post.date}
        dateModified={post.modified || undefined}
        authorName={post.author?.node?.name || 'Male Q'}
        url={`${SITE_URL}/guides/${slug}`}
        keywords={post.tags?.nodes?.map((tag) => tag.name)}
        articleSection={post.categories?.nodes?.[0]?.name}
      />

      {/* Breadcrumb Schema */}
      <BreadcrumbSchema
        items={[
          { name: t('breadcrumbHome'), url: SITE_URL },
          isNews
            ? { name: tNews('breadcrumb'), url: `${SITE_URL}/news` }
            : { name: t('breadcrumbGuides'), url: `${SITE_URL}/guides` },
          { name: post.title, url: `${SITE_URL}/guides/${slug}` },
        ]}
      />

      {/* Dev: Edit in WordPress link */}
      <DevEditLink type="post" databaseId={post.databaseId} wpBaseUrl={getWpBaseUrl()} />

      {/* Breadcrumb */}
      <Breadcrumbs
        items={
          isNews
            ? [
                { label: tNews('breadcrumb'), href: '/news' },
                { label: post.title },
              ]
            : [
                { label: t('breadcrumbGuides'), href: '/guides' },
                ...(post.categories?.nodes?.[0]
                  ? [{
                      label: post.categories.nodes[0].name,
                      href: `/guides/category/${post.categories.nodes[0].slug}`,
                    }]
                  : []),
                { label: post.title },
              ]
        }
      />

      {/* Header */}
      <header className='entry-header mb-8'>

        {/* Title */}
        <h1 className='entry-title text-4xl md:text-5xl font-bold text-foreground mb-6'>
          {post.title}
        </h1>

        {/* Meta */}
        <div className='flex items-center gap-4 text-muted-foreground'>
          <div className='flex items-center gap-2'>
            {post.author?.node?.avatar?.url && (
              <Image
                src='/images/Mr-Q-profile.png'
                alt={post.author.node.name}
                width={40}
                height={40}
                className='rounded-full'
              />
            )}
            <span className='font-medium'>{post.author?.node?.name}</span>
          </div>
          <span>•</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          {post.comments?.nodes && post.comments.nodes.length > 0 && (
            <>
              <span>•</span>
              <span>
                {t('commentCount', { count: post.comments.nodes.length })}
              </span>
            </>
          )}
        </div>
      </header>

      {/* Other-language versions of this guide */}
      <LanguageSwitcher translations={translations} locale={locale} />

      {/* Share buttons (top) */}
      <div className='border-y border-border py-3 mb-8'>
        <SocialShare
          url={`/guides/${slug}`}
          title={post.title}
          description={post.excerpt ? stripHtml(post.excerpt).slice(0, 200) : ''}
          image={
            post.featuredImage?.node?.sourceUrl
              ? getProductionImageUrl(post.featuredImage.node.sourceUrl)
              : ''
          }
          variant='icons'
        />
      </div>

      {/* Featured Image */}
      {post.featuredImage?.node && (
        <div className='entry-img relative w-full mb-8 rounded-lg overflow-hidden' style={{ aspectRatio: '16 / 9' }}>
          <Image
            src={getProductionImageUrl(post.featuredImage.node.sourceUrl)}
            alt={post.featuredImage.node.altText || post.title}
            fill
            className='object-cover'
            priority
          />
        </div>
      )}

      {/* Mobile Table of Contents */}
      <TableOfContents variant="mobile" />

      {/* Content (intro prose; for roundups this is the part before the
          [buyers_guide] marker, else the full body) */}
      <div
        className='entry-content prose prose-lg max-w-none mb-12 blog-content'
        dangerouslySetInnerHTML={{ __html: introHtml }}
      />

      {/* Programmatic "Best [X]" roundup: comparison table, ranked cards, FAQ,
          and ItemList/FAQPage schema — driven by the post ⇄ product relations
          + editorial overlay. Renders nothing for non-roundup posts. */}
      {isRoundup && <BuyersGuide guide={guide} title={post.title} />}

      {/* Conclusion / buying-advice prose (roundups only: the part after the
          marker). */}
      {isRoundup && outroHtml && (
        <div
          className='entry-content prose prose-lg max-w-none mb-12 blog-content'
          dangerouslySetInnerHTML={{ __html: outroHtml }}
        />
      )}

      {/* Enable lazy loading autoplay for videos */}
      <VideoAutoplay />

      {/* Enhance star ratings in product specs */}
      <StarRatingEnhancer />

      {/* Enhance checkmarks in product specs tables */}
      <CheckmarkEnhancer />

      {/* Intercept add-to-cart links and use local cart */}
      <AddToCartEnhancer products={blogProducts} />

      {/* Editor-curated recommended products & categories (meta-box driven) */}
      <RecommendedProducts
        products={recommendations.products}
        categories={recommendations.categories}
        locale={locale}
      />

      {/* Share buttons (bottom) */}
      <div className='border-t border-border pt-6 mb-12'>
        <SocialShare
          url={`/guides/${slug}`}
          title={post.title}
          description={post.excerpt ? stripHtml(post.excerpt).slice(0, 200) : ''}
          image={
            post.featuredImage?.node?.sourceUrl
              ? getProductionImageUrl(post.featuredImage.node.sourceUrl)
              : ''
          }
          variant='icons'
        />
      </div>

      {/* Tags */}
      {post.tags?.nodes && post.tags.nodes.length > 0 && (
        <div className='border-t border-border pt-6 mb-12'>
          <h3 className='text-sm font-semibold text-foreground mb-3'>{t('tagsLabel')}</h3>
          <div className='flex flex-wrap items-center gap-2'>
            {post.tags.nodes.map((tag) => (
              <Link
                key={tag.id}
                href={`/guides/tag/${tag.slug}`}
                className='inline-flex items-center px-3 py-1 bg-input text-foreground text-sm rounded-full hover:bg-border transition-colors leading-none'
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Related Posts */}
      <RelatedPosts posts={relatedPosts} currentSlug={slug} locale={locale} />

      {/* Comments Section */}
      <div className='border-t border-border py-8'>
        <h2 className='text-2xl font-bold text-foreground mb-6'>
          {post.comments?.nodes && post.comments.nodes.length > 0
            ? t('commentsHeadingWithCount', { count: post.comments.nodes.length })
            : t('commentsHeading')}
        </h2>

        {/* Comment Form */}
        <div className='bg-card border border-border rounded-lg p-6 my-8'>
          <h3 className='heading-plain text-lg font-semibold text-foreground mb-4'>
            {t('leaveACommentHeading')}
          </h3>
          <CommentForm postId={post.databaseId} />
        </div>

        {/* Existing Comments */}
        {post.comments?.nodes && post.comments.nodes.length > 0 && (() => {
          // Helper to check if author is admin/Mr. Q
          const isAdmin = (name: string | undefined) => {
            if (!name) return false;
            const lower = name.toLowerCase();
            return lower.includes('mr') || lower.includes('admin') || lower === 'maleq';
          };

          // Separate top-level comments and replies
          const topLevelComments = post.comments.nodes.filter(
            (c) => !c.parent?.node?.id
          );
          const replies = post.comments.nodes.filter(
            (c) => c.parent?.node?.id
          );

          // Get replies for a specific comment
          const getReplies = (commentId: string) =>
            replies.filter((r) => r.parent?.node?.id === commentId);

          return (
            <div className='space-y-6'>
              {topLevelComments.map((comment) => (
                <div key={comment.id}>
                  {/* Parent Comment */}
                  <div className='bg-card border border-border rounded-lg p-6'>
                    <div className='flex items-start gap-4'>
                      <Image
                        src={isAdmin(comment.author?.node?.name)
                          ? '/images/Mr-Q-profile.png'
                          : '/images/MQ-logo.png'
                        }
                        alt={comment.author?.node?.name || t('authorFallback')}
                        width={48}
                        height={48}
                        className='rounded-full'
                      />
                      <div className='flex-1'>
                        <div className='flex items-center gap-2 mb-2'>
                          <span className='font-semibold text-foreground'>
                            {comment.author?.node?.name}
                          </span>
                          <span className='text-sm text-muted-foreground'>
                            {formatDate(comment.date)}
                          </span>
                        </div>
                        <div
                          className='text-muted-foreground'
                          dangerouslySetInnerHTML={{
                            __html: sanitizeComment(comment.content),
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Replies */}
                  {getReplies(comment.id).length > 0 && (
                    <div className='ml-8 mt-4 space-y-4'>
                      {getReplies(comment.id).map((reply) => (
                        <div
                          key={reply.id}
                          className='bg-muted/50 border border-border rounded-lg p-4'
                        >
                          <div className='flex items-start gap-3'>
                            <Image
                              src={isAdmin(reply.author?.node?.name)
                                ? '/images/Mr-Q-profile.png'
                                : '/images/MQ-logo.png'
                              }
                              alt={reply.author?.node?.name || t('authorFallback')}
                              width={40}
                              height={40}
                              className='rounded-full'
                            />
                            <div className='flex-1'>
                              <div className='flex items-center gap-2 mb-2'>
                                <span className='font-semibold text-foreground text-sm'>
                                  {reply.author?.node?.name}
                                </span>
                                <span className='text-xs text-muted-foreground'>
                                  {formatDate(reply.date)}
                                </span>
                              </div>
                              <div
                                className='text-muted-foreground text-sm'
                                dangerouslySetInnerHTML={{
                                  __html: sanitizeComment(reply.content),
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </article>

        {/* Desktop Table of Contents Sidebar */}
        <aside className="hidden xl:block w-56 flex-shrink-0">
          <TableOfContents />
        </aside>
      </div>
    </div>
  );
}
