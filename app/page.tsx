import Link from 'next/link';
import { Metadata } from 'next';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_POSTS } from '@/lib/queries/posts';
import { getAllProducts, getHierarchicalCategories } from '@/lib/products/combined-service';
import ProductCard from '@/components/shop/ProductCard';
import BlogCard from '@/components/blog/BlogCard';
import HomeHero from '@/components/home/HomeHero';
import HomeBenefits from '@/components/home/HomeBenefits';
import NewsletterSection from '@/components/home/NewsletterSection';
import SocialSection from '@/components/home/SocialSection';
import FeaturedCategories from '@/components/shop/FeaturedCategories';

export const metadata: Metadata = {
  title: 'Male Q | Premium Adult Products - Fast & Discreet Shipping',
  description: 'Shop premium adult products with fast, discreet shipping. Expert guides, unsponsored reviews, and quality products to help you choose with confidence.',
  openGraph: {
    title: 'Male Q | Premium Adult Products',
    description: 'Shop premium adult products with fast, discreet shipping.',
    type: 'website',
  },
};

// ISR: Revalidate every 5 minutes for fresh content
export const revalidate = 300;

export default async function Home() {
  // Fetch data in parallel
  const [postsData, productsResult, categories] = await Promise.all([
    getClient().query({
      query: GET_ALL_POSTS,
      variables: { first: 6 },
      fetchPolicy: 'no-cache',
    }),
    getAllProducts({ limit: 8 }),
    getHierarchicalCategories(),
  ]);

  const posts = postsData?.data?.posts?.nodes || [];
  const products = productsResult.products;

  return (
    <div>
      {/* Hero Section */}
      <HomeHero />

      {/* Featured Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <FeaturedCategories categories={categories} />
      </section>

      {/* Featured Products */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Featured Products</h2>
            <p className="text-muted-foreground mt-1">Discover our most popular items</p>
          </div>
          <Link href="/shop" className="text-primary hover:text-primary-hover font-medium flex items-center gap-1">
            View All
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {products.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {products.map((product: any) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card border border-border rounded-lg">
            <p className="text-muted-foreground">No products available yet.</p>
          </div>
        )}
      </section>

      {/* Why Shop With Us */}
      <HomeBenefits />

      {/* Recent Blog Posts */}
      {posts.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h2 className="text-3xl font-bold text-foreground">Expert Guides & Reviews</h2>
              <p className="text-muted-foreground mt-1">Unsponsored advice to help you choose</p>
            </div>
            <Link href="/blog" className="text-primary hover:text-primary-hover font-medium flex items-center gap-1">
              View All
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.slice(0, 3).map((post: any) => (
              <BlogCard key={post.id} post={post} />
            ))}
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
