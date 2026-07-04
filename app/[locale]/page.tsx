import Link from 'next/link';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { buildLocaleAlternates } from '@/i18n/seo-alternates';
import {
  getFilteredProducts,
  getHierarchicalCategories,
  getTrendingProducts,
} from '@/lib/products/combined-service';
import { isMySQLConfigured } from '@/lib/db/pool';
import { queryProductIndex } from '@/lib/products/product-index';
import { indexEntriesToUnifiedProducts } from '@/lib/products/index-to-unified';
import { getBlogPosts } from '@/lib/blog/blog-service';
import BlogCard from '@/components/blog/BlogCard';
import SectionHeader from '@/components/ui/SectionHeader';
import NewsTicker from '@/components/blog/NewsTicker';
import ArticleHero from '@/components/blog/ArticleHero';
import HomeHero from '@/components/home/HomeHero';
import HomeBenefits from '@/components/home/HomeBenefits';
import TestimonialsSection from '@/components/home/TestimonialsSection';
import NewsletterSection from '@/components/home/NewsletterSection';
import SocialSection from '@/components/home/SocialSection';
import FeaturedCategories from '@/components/shop/FeaturedCategories';
import ProductCarousel from '@/components/product/ProductCarousel';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import type { Post } from '@/lib/types/wordpress';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home.meta' });
  return {
    title: {
      absolute: t('title'),
    },
    description: t('description'),
    openGraph: {
      title: t('ogTitle'),
      description: t('ogDescription'),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('ogTitle'),
      description: t('ogDescription'),
    },
    alternates: buildLocaleAlternates(locale, '/'),
  };
}

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;

export default async function Home({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  const useIndex = isMySQLConfigured() && process.env.DATA_SOURCE !== 'graphql';

  // Build product promises (index or GraphQL)
  const featuredProductsPromise = useIndex
    ? queryProductIndex({ inStock: true, limit: 8, sort: 'popularity' })
        .then((r) => ({ products: indexEntriesToUnifiedProducts(r.products) }))
        .catch(() => getFilteredProducts({ limit: 8, inStock: true }))
    : getFilteredProducts({ limit: 8, inStock: true });

  const trendingProductsPromise = useIndex
    ? queryProductIndex({
        onSale: true,
        inStock: true,
        limit: 12,
        sort: 'popularity',
      })
        .then((r) => indexEntriesToUnifiedProducts(r.products))
        .catch(() => getTrendingProducts(12))
    : getTrendingProducts(12);

  // Fetch data in parallel — blog listing uses SQL via blog-service (no
  // post body rendering needed for grid cards, so no GraphQL/do_blocks).
  const [postsResult, newsResult, productsResult, categories, trendingProducts] =
    await Promise.all([
      getBlogPosts({ first: 6, excludeCategorySlugs: ['news', 'espanol', 'cn'] }).catch(() => ({
        posts: [] as Post[],
        pageInfo: { hasNextPage: false, endCursor: null },
      })),
      getBlogPosts({ categorySlug: 'news', first: 12 }).catch(() => ({
        posts: [] as Post[],
        pageInfo: { hasNextPage: false, endCursor: null },
      })),
      featuredProductsPromise,
      getHierarchicalCategories().catch(() => []),
      trendingProductsPromise,
    ]);

  const posts = postsResult.posts;
  const newsPosts = newsResult.posts;
  const products = sortProductsByPriority(productsResult.products);

  return (
    <div>
      {/* Hero Section */}
      <HomeHero />

      {/* Featured Categories */}
      <section className='max-w-screen-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12'>
        <FeaturedCategories categories={categories} />
      </section>

      {/* Featured Products */}
      {products.length > 0 && (
        <section className='max-w-screen-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 sm:pb-16'>
          <ProductCarousel
            products={products}
            title={t('featured.title')}
            subtitle={t('featured.subtitle')}
            viewAllLink='/shop'
            viewAllText={t('featured.viewAll')}
            showGradients
            showMobileHint
            variant='section'
          />
        </section>
      )}

      {/* Trending Products Carousel */}
      {trendingProducts.length > 0 && (
        <section className='py-6 sm:py-12 bg-muted/30'>
          <div className='max-w-screen-3xl mx-auto px-4 sm:px-6 lg:px-8'>
            <ProductCarousel
              products={trendingProducts}
              title={t('trending.title')}
              subtitle={t('trending.subtitle')}
              badge={
                <span className='inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full'>
                  <svg
                    className='w-3 h-3'
                    fill='currentColor'
                    viewBox='0 0 20 20'
                  >
                    <path
                      fillRule='evenodd'
                      d='M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z'
                      clipRule='evenodd'
                    />
                  </svg>
                  {t('trending.hotDealsBadge')}
                </span>
              }
              viewAllLink='/shop?onSale=true'
              showGradients
              showMobileHint
              variant='section'
            />
          </div>
        </section>
      )}

      {/* Why Shop With Us */}
      <HomeBenefits />

      {/* Recent Blog Posts */}
      {posts.length > 0 && (
        <section className='max-w-screen-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16'>
          <div className='mb-8'>
            <h2 className='text-2xl sm:text-3xl font-bold text-foreground'>
              {t('blogStrip.heading')}
            </h2>
            <p className='text-muted-foreground mt-1'>
              {t('blogStrip.subtitle')}
            </p>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6'>
            {posts.slice(0, 4).map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
          <div className='mt-8 text-center'>
            <Link
              href='/guides'
              className='text-primary hover:text-primary-hover font-medium inline-flex items-center gap-1'
            >
              {t('blogStrip.viewAll')}
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 5l7 7-7 7'
                />
              </svg>
            </Link>
          </div>
        </section>
      )}

      {/* Testimonials */}
      <TestimonialsSection />

      {/* Latest News */}
      {newsPosts.length > 0 && (
        <section className='max-w-screen-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16'>
          <SectionHeader
            title={t('newsStrip.heading')}
            viewAllHref='/news'
            viewAllLabel={t('newsStrip.viewAll')}
            className='mb-8'
          />
          <ArticleHero posts={newsPosts} />
          <div className='mt-8'>
            <NewsTicker posts={newsPosts.slice(0, 6)} />
          </div>
        </section>
      )}

      {/* Social Media / YouTube Section */}
      <SocialSection />

      {/* Newsletter */}
      <NewsletterSection />
    </div>
  );
}
