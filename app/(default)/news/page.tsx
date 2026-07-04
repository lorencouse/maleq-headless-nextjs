import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getNewsLanding, getBlogPosts } from '@/lib/blog/blog-service';
import BlogPostsGrid from '@/components/blog/BlogPostsGrid';
import BlogSearch from '@/components/blog/BlogSearch';
import ArticleHero from '@/components/blog/ArticleHero';
import ArticleCarousel from '@/components/blog/ArticleCarousel';
import BlogCard from '@/components/blog/BlogCard';
import NewsTicker from '@/components/blog/NewsTicker';
import TopicChips from '@/components/blog/TopicChips';
import FeatureSpotlight from '@/components/blog/FeatureSpotlight';
import TrendingList from '@/components/blog/TrendingList';
import SocialSection from '@/components/home/SocialSection';
import NewsletterSection from '@/components/home/NewsletterSection';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import SectionHeader from '@/components/ui/SectionHeader';

// News hub is editorial and has no searchParams → safe to statically render
// and revalidate. News wants to stay fresh.
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'news' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    openGraph: { title: t('metaTitle'), description: t('metaDescription'), type: 'website' },
    alternates: { canonical: '/news' },
  };
}

export default async function NewsPage() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'news' });

  const [{ hero, topics, spotlight, trending, tagSections, fromGuides }, newsTail] = await Promise.all([
    getNewsLanding(),
    getBlogPosts({ categorySlug: 'news', first: 12 }),
  ]);

  // First rail leads; the rest follow the spotlight beat.
  const [firstRail, ...restRails] = tagSections;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
        <Breadcrumbs items={[{ label: t('breadcrumb') }]} />

        {/* Search */}
        <div className="mt-2 mb-8">
          <BlogSearch />
        </div>

        {/* Hero — latest news */}
        {hero.length > 0 && <ArticleHero posts={hero} />}

        {/* Header */}
        <div className="mt-10 lg:mt-12 mb-6">
          <h1 className="text-4xl font-bold text-foreground mb-1">{t('pageTitle')}</h1>
          <p className="text-lg text-muted-foreground">{t('pageSubtitle')}</p>
        </div>

        {/* Latest ticker */}
        {hero.length > 0 && (
          <div className="mb-8">
            <NewsTicker posts={hero} />
          </div>
        )}

        {/* Topic chips */}
        {topics.length > 0 && (
          <div className="mb-2">
            <TopicChips topics={topics} label={t('exploreTopics')} />
          </div>
        )}

        {/* Rails + spotlight + trending */}
        <div className="mt-12 lg:mt-16 space-y-12 lg:space-y-16">
          {firstRail && (
            <ArticleCarousel
              title={firstRail.name}
              posts={firstRail.posts}
              viewAllLink={`/guides/tag/${firstRail.slug}`}
            />
          )}

          {spotlight && <FeatureSpotlight post={spotlight} />}

          {restRails.map((section) => (
            <ArticleCarousel
              key={section.slug}
              title={section.name}
              posts={section.posts}
              viewAllLink={`/guides/tag/${section.slug}`}
            />
          ))}

          {trending.length > 0 && <TrendingList posts={trending} />}
        </div>

        {/* From the guides */}
        {fromGuides.length > 0 && (
          <section className="mt-12 lg:mt-16 border-t border-border pt-10">
            <SectionHeader title={t('fromTheGuides')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {fromGuides.slice(0, 4).map((post) => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Follow us (full-bleed) */}
      <SocialSection />

      {/* Newsletter band (full-bleed) */}
      <NewsletterSection heading={t('newsletterHeading')} subtitle={t('newsletterSubtitle')} />

      {/* More news (infinite scroll) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <SectionHeader title={t('moreNews')} />
        <BlogPostsGrid
          initialPosts={newsTail.posts}
          initialPageInfo={{ hasNextPage: newsTail.pageInfo.hasNextPage, endCursor: newsTail.pageInfo.endCursor }}
          categorySlug="news"
        />
      </div>
    </>
  );
}
