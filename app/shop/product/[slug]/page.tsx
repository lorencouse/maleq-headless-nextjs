import { getProductBySlug, getAllProductSlugs } from '@/lib/products/product-service';
import { notFound } from 'next/navigation';
import ProductImageGallery from '@/components/product/ProductImageGallery';
import ProductSpecifications from '@/components/product/ProductSpecifications';
import RawDataDebug from '@/components/product/RawDataDebug';
import ProductPageClient from '@/components/product/ProductPageClient';

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Breadcrumb */}
      <div className="mb-8 text-sm text-gray-600">
        <a href="/shop" className="hover:text-blue-600">Shop</a>
        {product.category && (
          <>
            {' '}/{' '}
            <a href={`/shop?category=${product.category.slug}`} className="hover:text-blue-600">
              {product.category.name}
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
            images={product.gallery}
            productName={product.name}
          />
        </div>

        {/* Product Details */}
        <div>
          {/* Source Badge */}
          <div className="mb-4 flex items-center gap-3">
            {product.category && (
              <span className="text-sm text-gray-500">
                {product.category.name}
              </span>
            )}
            {product.manufacturer && (
              <>
                {product.category && <span className="text-gray-300">•</span>}
                <span className="text-sm text-gray-500">
                  {product.manufacturer.name}
                </span>
              </>
            )}
            <span className={`ml-auto px-2 py-1 text-xs font-semibold rounded ${
              product.source === 'WILLIAMS_TRADING'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-purple-100 text-purple-800'
            }`}>
              {product.source === 'WILLIAMS_TRADING' ? 'Warehouse' : 'WordPress'}
            </span>
          </div>

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

      {/* Raw API Data (for development/debugging) */}
      {product.rawApiData && process.env.NODE_ENV === 'development' && (
        <RawDataDebug
          data={product.rawApiData}
          title={`Raw ${product.source} API Data`}
        />
      )}
    </div>
  );
}
