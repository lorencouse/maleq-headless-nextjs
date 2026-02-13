import { getProductBySlug, getAllProductSlugs } from '@/lib/products/product-service';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import { stripHtml } from '@/lib/utils/text-utils';
import { getFilteredProducts } from '@/lib/products/combined-service';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import dynamic from 'next/dynamic';
import ProductDetailsWrapper from '@/components/product/ProductDetailsWrapper';
import ProductSpecifications from '@/components/product/ProductSpecifications';
import RelatedProducts from '@/components/product/RelatedProducts';

const ProductReviews = dynamic(
  () => import('@/components/reviews/ProductReviews')
);
import RecentlyViewed from '@/components/product/RecentlyViewed';
import TrackRecentlyViewed from '@/components/product/TrackRecentlyViewed';
import { ProductSchema } from '@/components/seo/StructuredData';
import DevEditLink from '@/components/dev/DevEditLink';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;
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
    ? stripHtml(product.shortDescription).slice(0, 160)
    : product.description
    ? stripHtml(product.description).slice(0, 160)
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

  // Fetch related products from same category (in-stock only)
  let relatedProducts: Awaited<ReturnType<typeof getFilteredProducts>>['products'] = [];
  if (primaryCategory?.slug) {
    try {
      const result = await getFilteredProducts({ category: primaryCategory.slug, limit: 8, inStock: true });
      relatedProducts = result.products;
    } catch (error) {
      console.error('Error fetching related products:', error);
    }
  }

  // Prepare structured data
  const productPrice = parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0');
  const productDescription = product.shortDescription
    ? stripHtml(product.shortDescription).slice(0, 300)
    : product.description
    ? stripHtml(product.description).slice(0, 300)
    : `Shop ${product.name} at Male Q.`;

  const stockStatus = product.stockStatus === 'IN_STOCK' ? 'InStock' : 'OutOfStock';
  const productImages = product.gallery?.map(img => img.url) || (product.image ? [product.image.url] : []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
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
      <Breadcrumbs
        items={[
          { label: 'Shop', href: '/shop' },
          ...(primaryCategory
            ? [{ label: primaryCategory.name, href: `/sex-toys/${primaryCategory.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      {/* Product Details with Image Gallery */}
      <ProductDetailsWrapper product={product} />

      {/* Product Description */}
      {product.description && (
        <div className="mt-16 border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Product Description</h2>
          <div className="prose prose-lg max-w-none text-foreground/80 leading-relaxed dark:prose-invert">
            {stripHtml(product.description)}
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
