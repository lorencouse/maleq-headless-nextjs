import { getProductBySlug, getAllProductSlugs } from '@/lib/products/product-service';
import { getProductsByCategory } from '@/lib/products/combined-service';
import { notFound } from 'next/navigation';
import ProductImageGallery from '@/components/product/ProductImageGallery';
import ProductSpecifications from '@/components/product/ProductSpecifications';
import ProductPageClient from '@/components/product/ProductPageClient';
import ProductReviews from '@/components/reviews/ProductReviews';
import RelatedProducts from '@/components/product/RelatedProducts';
import RecentlyViewed from '@/components/product/RecentlyViewed';
import TrackRecentlyViewed from '@/components/product/TrackRecentlyViewed';

export const revalidate = 3600; // Revalidate every hour for stock updates

// Generate static params for all products
export async function generateStaticParams() {
  try {
    const slugs = await getAllProductSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch (error) {
    console.error('Error generating static params:', error);
    return [];
  }
}

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  // Get primary category
  const primaryCategory = product.categories?.[0];

  // Fetch related products from same category
  let relatedProducts: Awaited<ReturnType<typeof getProductsByCategory>> = [];
  if (primaryCategory?.slug) {
    try {
      relatedProducts = await getProductsByCategory(primaryCategory.slug, 8);
    } catch (error) {
      console.error('Error fetching related products:', error);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Breadcrumb */}
      <div className="mb-8 text-sm text-gray-600">
        <a href="/shop" className="hover:text-blue-600">Shop</a>
        {primaryCategory && (
          <>
            {' '}/{' '}
            <a href={`/shop?category=${primaryCategory.slug}`} className="hover:text-blue-600">
              {primaryCategory.name}
            </a>
          </>
        )}
        {' '}/{' '}
        <span className="text-gray-900">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Product Images */}
        <div>
          <ProductImageGallery
            images={product.gallery.map(img => ({
              ...img,
              title: img.altText,
            }))}
            productName={product.name}
          />
        </div>

        {/* Product Details */}
        <div>
          {/* Category Badge */}
          {primaryCategory && (
            <div className="mb-4">
              <span className="text-sm text-gray-500">
                {primaryCategory.name}
              </span>
            </div>
          )}

          {/* Product Name */}
          <h1 className="text-4xl font-bold text-gray-900 mb-6">{product.name}</h1>

          {/* Client-side interactive components (price, stock, variations, add to cart) */}
          <ProductPageClient product={product} />
        </div>
      </div>

      {/* Product Description */}
      {product.description && (
        <div className="mt-16 border-t border-gray-200 pt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Product Description</h2>
          <div className="prose prose-lg max-w-none text-gray-700 leading-relaxed">
            {product.description.replace(/<[^>]*>/g, '')}
          </div>
        </div>
      )}

      {/* Product Specifications */}
      {product.specifications && product.specifications.length > 0 && (
        <ProductSpecifications specifications={product.specifications} />
      )}

      {/* Product Reviews */}
      <ProductReviews
        productId={product.databaseId}
        productName={product.name}
        averageRating={product.averageRating || 0}
        reviewCount={product.reviewCount || 0}
      />

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <RelatedProducts
          products={relatedProducts}
          currentProductId={product.id}
          title="You May Also Like"
        />
      )}

      {/* Recently Viewed */}
      <RecentlyViewed currentProductId={product.id} />

      {/* Track this product view */}
      <TrackRecentlyViewed
        productId={product.databaseId?.toString() || product.id}
        name={product.name}
        slug={product.slug}
        price={parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0')}
        regularPrice={parseFloat(product.regularPrice?.replace(/[^0-9.]/g, '') || '0')}
        image={product.image || undefined}
      />
    </div>
  );
}
