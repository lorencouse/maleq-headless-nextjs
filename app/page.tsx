import Link from 'next/link';
import { Metadata } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_POSTS } from '@/lib/queries/posts';
import {
  getFilteredProducts,
  getHierarchicalCategories,
  getTrendingProducts,
} from '@/lib/products/combined-service';
import ProductCard from '@/components/shop/ProductCard';
import BlogCard from '@/components/blog/BlogCard';
import HomeHero from '@/components/home/HomeHero';
import HomeBenefits from '@/components/home/HomeBenefits';
import TestimonialsSection from '@/components/home/TestimonialsSection';
import NewsletterSection from '@/components/home/NewsletterSection';
import SocialSection from '@/components/home/SocialSection';
import FeaturedCategories from '@/components/shop/FeaturedCategories';
import ProductCarousel from '@/components/product/ProductCarousel';
import { sortProductsByPriority } from '@/lib/utils/product-sort';

export const metadata: Metadata = {
  title: { absolute: 'Male Q - Premium Adult Products | Fast & Discreet Shipping' },
  description:
    'Shop premium adult products with fast, discreet shipping. Expert guides, unsponsored reviews, and quality products to help you choose with confidence.',
  openGraph: {
    title: 'Male Q | Premium Adult Products',
    description: 'Shop premium adult products with fast, discreet shipping.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Male Q | Premium Adult Products',
    description: 'Shop premium adult products with fast, discreet shipping.',
  },
  alternates: {
    canonical: '/',
  },
};

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;

export default async function Home() {
  // Fetch data in parallel
  const [postsData, productsResult, categories, trendingProducts] =
    await Promise.all([
      getClient().query({
        query: GET_ALL_POSTS,
        variables: { first: 6 },
      }),
      getFilteredProducts({ limit: 8, inStock: true }),
      getHierarchicalCategories(),
      getTrendingProducts(12),
    ]);

  const posts = postsData?.data?.posts?.nodes || [];
  const products = sortProductsByPriority(productsResult.products);

  return (
    <div>
      {/* Hero Section */}
      <HomeHero />

      {/* Featured Categories */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12'>
        <FeaturedCategories categories={categories} />
      </section>

      {/* Featured Products */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 sm:pb-16'>
        <div className='mb-8'>
          <h2 className='text-2xl sm:text-3xl font-bold text-foreground'>
            Featured Products
          </h2>
          <p className='text-muted-foreground mt-1'>
            Discover our most popular items
          </p>
        </div>

        {products.length > 0 ? (
          <div className='grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-4 sm:gap-6'>
            {products.map((product: any) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className='text-center py-12 bg-card border border-border rounded-lg'>
            <p className='text-muted-foreground'>No products available yet.</p>
          </div>
        )}

        <div className='mt-8 text-center'>
          <Link
            href='/shop'
            className='text-primary hover:text-primary-hover font-medium inline-flex items-center gap-1'
          >
            View All Products
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

      {/* Trending Products Carousel */}
      {trendingProducts.length > 0 && (
        <section className='py-6 sm:py-12 bg-muted/30'>
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
            <ProductCarousel
              products={trendingProducts}
              title='Trending Now'
              subtitle='Our most popular products right now'
              badge={
                <span className='inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-semibold rounded-full'>
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
                  Hot Deals
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
        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16'>
          <div className='mb-8'>
            <h2 className='text-2xl sm:text-3xl font-bold text-foreground'>
              Expert Guides & Reviews
            </h2>
            <p className='text-muted-foreground mt-1'>
              Unsponsored advice to help you choose
            </p>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'>
            {posts.slice(0, 3).map((post: any) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
          <div className='mt-8 text-center'>
            <Link
              href='/guides'
              className='text-primary hover:text-primary-hover font-medium inline-flex items-center gap-1'
            >
              View All Articles
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

      {/* Social Media / YouTube Section */}
      <SocialSection />

      {/* Newsletter */}
      <NewsletterSection />
    </div>
  );
}
