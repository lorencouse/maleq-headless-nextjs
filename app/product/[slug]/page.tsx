import { getProductBySlug, getAllProductSlugs } from '@/lib/products/product-service';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import { getProductsByCategory } from '@/lib/products/combined-service';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import ProductDetailsWrapper from '@/components/product/ProductDetailsWrapper';
import ProductSpecifications from '@/components/product/ProductSpecifications';
import ProductReviews from '@/components/reviews/ProductReviews';
import RelatedProducts from '@/components/product/RelatedProducts';
import RecentlyViewed from '@/components/product/RecentlyViewed';
import TrackRecentlyViewed from '@/components/product/TrackRecentlyViewed';
import { ProductSchema } from '@/components/seo/StructuredData';
import DevEditLink from '@/components/dev/DevEditLink';

// ISR: Revalidate every 24 hours for fresh stock/price data
export const revalidate = 86400;
export const dynamicParams = true; // Allow runtime generation of any product page

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Generate metadata for product page
export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: 'Product Not Found',
    };
  }

  const price = product.price?.replace(/[^0-9.]/g, '') || '0';
  const description = product.shortDescription
    ? product.shortDescription.replace(/<[^>]*>/g, '').slice(0, 160)
    : product.description
    ? product.description.replace(/<[^>]*>/g, '').slice(0, 160)
    : `Shop ${product.name} at Male Q. Fast, discreet shipping available.`;

  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      url: `${SITE_URL}/product/${slug}`,
      type: 'website',
      images: product.image
        ? [
            {
              url: product.image.url,
              width: 800,
              height: 800,
              alt: product.name,
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description,
      images: product.image ? [product.image.url] : [],
    },
    alternates: {
      canonical: `${SITE_URL}/product/${slug}`,
    },
    other: {
      'product:price:amount': price,
      'product:price:currency': 'USD',
    },
  };
}

// Generate static params for all products
// In development, limits to DEV_LIMITS.products pages for faster builds
export async function generateStaticParams() {
  try {
    const slugs = await getAllProductSlugs();
    const params = slugs.map((slug) => ({ slug }));
    return limitStaticParams(params, DEV_LIMITS.products);
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

  // Prepare structured data
  const productPrice = parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0');
  const productDescription = product.shortDescription
    ? product.shortDescription.replace(/<[^>]*>/g, '').slice(0, 300)
    : product.description
    ? product.description.replace(/<[^>]*>/g, '').slice(0, 300)
    : `Shop ${product.name} at Male Q.`;

  const stockStatus = product.stockStatus === 'IN_STOCK' ? 'InStock' : 'OutOfStock';
  const productImages = product.gallery?.map(img => img.url) || (product.image ? [product.image.url] : []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Dev: Edit in WordPress link */}
      <DevEditLink type="product" databaseId={product.databaseId} />

      {/* Product Structured Data */}
      <ProductSchema
        name={product.name}
        description={productDescription}
        image={productImages.length > 0 ? productImages : '/placeholder.jpg'}
        sku={product.sku || undefined}
        brand={product.brands?.[0]?.name || product.categories?.[0]?.name}
        price={productPrice}
        availability={stockStatus as 'InStock' | 'OutOfStock'}
        url={`${SITE_URL}/product/${product.slug}`}
        reviewCount={product.reviewCount || undefined}
        ratingValue={product.averageRating || undefined}
      />

      {/* Breadcrumb */}
      <div className="mb-8 text-sm text-muted-foreground">
        <a href="/shop" className="hover:text-primary transition-colors">Shop</a>
        {primaryCategory && (
          <>
            {' '}/{' '}
            <a href={`/product-category/${primaryCategory.slug}`} className="hover:text-primary transition-colors">
              {primaryCategory.name}
            </a>
          </>
        )}
        {' '}/{' '}
        <span className="text-foreground">{product.name}</span>
      </div>

      {/* Product Details with Image Gallery */}
      <ProductDetailsWrapper product={product} />

      {/* Product Description */}
      {product.description && (
        <div className="mt-16 border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Product Description</h2>
          <div className="prose prose-lg max-w-none text-foreground/80 leading-relaxed dark:prose-invert">
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
        productId={product.databaseId || parseInt(product.id)}
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
