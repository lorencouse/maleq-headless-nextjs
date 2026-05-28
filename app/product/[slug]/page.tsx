import { getProductBySlug, getAllProductSlugs } from '@/lib/products/product-service';
import { limitStaticParams, DEV_LIMITS } from '@/lib/utils/static-params';
import { stripHtml } from '@/lib/utils/text-utils';
import { getFilteredProducts } from '@/lib/products/combined-service';
import { renderProductDescriptionHtml } from '@/lib/product/description-html';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { getTranslations } from 'next-intl/server';
import ProductDetailsWrapper from '@/components/product/ProductDetailsWrapper';
import ProductSpecifications from '@/components/product/ProductSpecifications';
import RelatedProducts from '@/components/product/RelatedProducts';
import RelatedGuides from '@/components/product/RelatedGuides';
import { loadRelatedPostsForProduct } from '@/lib/db/post-relations';
import { getIndexEntryBySlug } from '@/lib/products/product-index';
import type { Post } from '@/lib/types/wordpress';

const ProductReviews = dynamic(
  () => import('@/components/reviews/ProductReviews')
);
import RecentlyViewed from '@/components/product/RecentlyViewed';
import TrackRecentlyViewed from '@/components/product/TrackRecentlyViewed';
import { ProductSchema, BreadcrumbSchema } from '@/components/seo/StructuredData';
import DevEditLink from '@/components/dev/DevEditLink';
import { getWpBaseUrl } from '@/lib/db/wp-url';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;
export const dynamicParams = true; // Allow runtime generation of any product page

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

// Generate metadata for product page
export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  // Hard-coded 'en' instead of getLocale(): this page has `revalidate = N`
  // (ISR) and next-intl's getLocale() reads request headers, which throws
  // DYNAMIC_SERVER_USAGE under ISR. Per D1=A, content-root routes render
  // with English chrome regardless of cookie.
  const locale = 'en';
  const t = await getTranslations({ locale, namespace: 'productSlugPage' });
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: t('metaNotFound'),
    };
  }

  const price = product.price?.replace(/[^0-9.]/g, '') || '0';
  const brand = product.brands?.[0]?.name;
  const description = product.shortDescription
    ? stripHtml(product.shortDescription).slice(0, 160)
    : product.description
    ? stripHtml(product.description).slice(0, 160)
    : t('metaDescriptionFallback', { name: product.name });

  // Build a richer title with brand context when available
  const metaTitle = brand
    ? t('metaTitleWithBrand', { name: product.name, brand })
    : product.name;

  return {
    title: metaTitle,
    description,
    openGraph: {
      title: metaTitle,
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
      title: metaTitle,
      description,
      images: product.image ? [product.image.url] : [],
    },
    alternates: {
      canonical: `${SITE_URL}/product/${slug}`,
    },
    other: {
      'product:price:amount': price,
      'product:price:currency': 'USD',
      ...(brand && { 'product:brand': brand }),
      ...(product.stockStatus === 'IN_STOCK'
        ? { 'product:availability': 'instock' }
        : { 'product:availability': 'oos' }),
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
  // See generateMetadata above for why this is hard-coded 'en' instead of getLocale().
  const locale = 'en';
  const t = await getTranslations({ locale, namespace: 'productSlugPage' });

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

  // Fetch "Related Guides" — blog posts that recommend this product (or its
  // categories) via the post ⇄ product relations meta box. The index entry
  // gives us both the canonical product ID and its category term IDs.
  let relatedGuides: Post[] = [];
  try {
    const indexEntry = await getIndexEntryBySlug(slug);
    const productId = indexEntry?.id ?? product.databaseId;
    if (productId) {
      relatedGuides = await loadRelatedPostsForProduct({
        productId,
        categoryTermIds: indexEntry?.categoryIds ?? [],
        limit: 6,
      });
    }
  } catch (error) {
    console.error('Error fetching related guides:', error);
  }

  // Prepare structured data
  const productPrice = parseFloat(product.regularPrice?.replace(/[^0-9.]/g, '') || product.price?.replace(/[^0-9.]/g, '') || '0');
  const productSalePrice = product.onSale ? parseFloat(product.salePrice?.replace(/[^0-9.]/g, '') || '0') : undefined;
  const productDescription = product.shortDescription
    ? stripHtml(product.shortDescription).slice(0, 300)
    : product.description
    ? stripHtml(product.description).slice(0, 300)
    : t('shortDescriptionFallback', { name: product.name });

  const stockStatus = product.stockStatus === 'IN_STOCK' ? 'InStock' : 'OutOfStock';
  const productImages = product.gallery?.map(img => img.url) || (product.image ? [product.image.url] : []);
  const productBrand = product.brands?.[0]?.name;
  const productCategory = product.categories?.[0]?.name;
  const productMaterial = product.materials?.[0]?.name;

  // Check if SKU looks like a UPC/EAN barcode (12-13 digits)
  const productGtin = product.sku && /^\d{12,13}$/.test(product.sku) ? product.sku : undefined;

  return (
    <>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
      {/* Dev: Edit in WordPress link */}
      <DevEditLink type="product" databaseId={product.databaseId} wpBaseUrl={getWpBaseUrl()} />

      {/* Product Structured Data */}
      <ProductSchema
        name={product.name}
        description={productDescription}
        image={productImages.length > 0 ? productImages : '/placeholder.jpg'}
        sku={product.sku || undefined}
        gtin={productGtin}
        brand={productBrand || productCategory}
        price={productPrice}
        salePrice={productSalePrice}
        availability={stockStatus as 'InStock' | 'OutOfStock'}
        url={`${SITE_URL}/product/${product.slug}`}
        category={productCategory}
        material={productMaterial}
        reviewCount={product.reviewCount || undefined}
        ratingValue={product.averageRating || undefined}
      />

      {/* Breadcrumb Schema */}
      <BreadcrumbSchema
        items={[
          { name: t('breadcrumbHome'), url: SITE_URL },
          { name: t('breadcrumbSexToys'), url: `${SITE_URL}/sex-toys` },
          ...(primaryCategory
            ? [{ name: primaryCategory.name, url: `${SITE_URL}/sex-toys/${primaryCategory.slug}` }]
            : []),
          { name: product.name, url: `${SITE_URL}/product/${product.slug}` },
        ]}
      />

      {/* Breadcrumb */}
      <Breadcrumbs
        items={[
          { label: t('breadcrumbShop'), href: '/shop' },
          ...(primaryCategory
            ? [{ label: primaryCategory.name, href: `/sex-toys/${primaryCategory.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      {/* Product Details with Image Gallery */}
      <Suspense>
        <ProductDetailsWrapper product={product} />
      </Suspense>

      {/* Product Description */}
      {product.description && (
        <div className="mt-16 border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">{t('descriptionHeading')}</h2>
          <div
            className="product-description-content max-w-none"
            dangerouslySetInnerHTML={{ __html: renderProductDescriptionHtml(product.description) }}
          />
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

      {/* Track this product view */}
      <TrackRecentlyViewed
        productId={product.databaseId?.toString() || product.id}
        name={product.name}
        slug={product.slug}
        price={parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0')}
        regularPrice={parseFloat(product.regularPrice?.replace(/[^0-9.]/g, '') || '0')}
        image={product.image || undefined}
        salePrice={product.salePrice}
        shortDescription={product.shortDescription}
        categories={product.categories?.map(c => c.name) || []}
        brand={product.brands?.[0]?.name || null}
      />
    </div>

    {/* Full-width carousels outside max-w container */}
    <div className="px-4 sm:px-6 lg:px-8 pb-8 sm:pb-12">
      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <RelatedProducts
          products={relatedProducts}
          currentProductId={product.id}
        />
      )}

      {/* Related Guides (reverse of post ⇄ product relations) */}
      <RelatedGuides posts={relatedGuides} />

      {/* Recently Viewed */}
      <RecentlyViewed currentProductId={product.id} />
    </div>
    </>
  );
}
