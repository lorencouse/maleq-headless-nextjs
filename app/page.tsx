import Link from 'next/link';
import { getClient } from '@/lib/apollo/client';
import { GET_ALL_POSTS } from '@/lib/queries/posts';
import { getAllProducts } from '@/lib/products/combined-service';
import BlogCard from '@/components/blog/BlogCard';
import ProductCard from '@/components/shop/ProductCard';

export const revalidate = 1800; // Revalidate every 30 minutes

export default async function Home() {
  // Fetch latest posts and products
  const [postsData, productsResult] = await Promise.all([
    getClient().query({
      query: GET_ALL_POSTS,
      variables: { first: 3 },
    }),
    getAllProducts({ limit: 4 }),
  ]);

  const posts = postsData?.data?.posts?.nodes || [];
  const products = productsResult.products;

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-primary to-primary-dark text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">Welcome to Maleq</h1>
          <p className="text-xl mb-8 max-w-2xl mx-auto">
            Discover quality products and engaging content powered by modern technology
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/shop"
              className="bg-white text-primary px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
            >
              Shop Now
            </Link>
            <Link
              href="/blog"
              className="border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white hover:text-primary transition-colors"
            >
              Read Blog
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-foreground">Featured Products</h2>
          <Link href="/shop" className="text-primary hover:text-primary-hover font-medium">
            View All →
          </Link>
        </div>

        {products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product: any) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card border border-border rounded-lg">
            <p className="text-muted-foreground">No products available yet.</p>
            <p className="text-sm text-muted mt-2">
              Make sure your WordPress backend is configured correctly.
            </p>
          </div>
        )}
      </section>

      {/* Latest Blog Posts */}
      <section className="bg-input py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-foreground">Latest Articles</h2>
            <Link href="/blog" className="text-primary hover:text-primary-hover font-medium">
              View All →
            </Link>
          </div>

          {posts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post: any) => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card border border-border rounded-lg">
              <p className="text-muted-foreground">No blog posts available yet.</p>
              <p className="text-sm text-muted mt-2">
                Make sure your WordPress backend is configured correctly.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-foreground text-center mb-12">
          Why Choose Maleq?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Lightning Fast</h3>
            <p className="text-muted-foreground">Optimized performance with Next.js and modern technology</p>
          </div>
          <div className="text-center">
            <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Secure & Reliable</h3>
            <p className="text-muted-foreground">Built with security and reliability in mind</p>
          </div>
          <div className="text-center">
            <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Best Value</h3>
            <p className="text-muted-foreground">Quality products at competitive prices</p>
          </div>
        </div>
      </section>
    </div>
  );
}
