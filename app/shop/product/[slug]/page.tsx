import { getClient } from '@/lib/apollo/client';
import { GET_PRODUCT_BY_SLUG, GET_ALL_PRODUCT_SLUGS } from '@/lib/queries/products';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export const revalidate = 300; // Revalidate every 5 minutes for real-time inventory

// Generate static params for all products
export async function generateStaticParams() {
  const { data } = await getClient().query({
    query: GET_ALL_PRODUCT_SLUGS,
  });

  return data?.products?.nodes?.map((product: { slug: string }) => ({
    slug: product.slug,
  })) || [];
}

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  const { data } = await getClient().query({
    query: GET_PRODUCT_BY_SLUG,
    variables: { slug },
  });

  const product = data?.product;

  if (!product) {
    notFound();
  }

  const formatPrice = (price: string | undefined) => {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Product Images */}
        <div>
          <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-200 mb-4">
            {product.image ? (
              <Image
                src={product.image.sourceUrl}
                alt={product.image.altText || product.name}
                fill
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                No Image
              </div>
            )}
          </div>

          {/* Gallery Images */}
          {product.galleryImages?.nodes && product.galleryImages.nodes.length > 0 && (
            <div className="grid grid-cols-4 gap-4">
              {product.galleryImages.nodes.slice(0, 4).map((image: any) => (
                <div key={image.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-200">
                  <Image
                    src={image.sourceUrl}
                    alt={image.altText || product.name}
                    fill
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Product Details */}
        <div>
          {/* Categories */}
          {product.productCategories?.nodes && product.productCategories.nodes.length > 0 && (
            <div className="mb-4">
              <span className="text-sm text-gray-500">
                {product.productCategories.nodes[0].name}
              </span>
            </div>
          )}

          {/* Product Name */}
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{product.name}</h1>

          {/* Rating */}
          {product.averageRating && product.averageRating > 0 && (
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className={`h-5 w-5 ${
                      i < Math.floor(product.averageRating!)
                        ? 'text-yellow-400'
                        : 'text-gray-300'
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              {product.reviewCount && product.reviewCount > 0 && (
                <span className="text-sm text-gray-600">
                  ({product.reviewCount} reviews)
                </span>
              )}
            </div>
          )}

          {/* Price */}
          <div className="mb-6">
            {product.onSale && product.regularPrice ? (
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold text-red-600">
                  {formatPrice(product.salePrice)}
                </span>
                <span className="text-xl text-gray-500 line-through">
                  {formatPrice(product.regularPrice)}
                </span>
                <span className="px-3 py-1 bg-red-100 text-red-600 text-sm font-semibold rounded-full">
                  SALE
                </span>
              </div>
            ) : (
              <span className="text-3xl font-bold text-gray-900">
                {formatPrice(product.price || product.regularPrice)}
              </span>
            )}
          </div>

          {/* Stock Status */}
          <div className="mb-6">
            {product.stockStatus === 'IN_STOCK' ? (
              <p className="text-green-600 font-medium">In Stock</p>
            ) : product.stockStatus === 'OUT_OF_STOCK' ? (
              <p className="text-red-600 font-medium">Out of Stock</p>
            ) : (
              <p className="text-yellow-600 font-medium">On Backorder</p>
            )}
            {product.stockQuantity && product.stockQuantity > 0 && (
              <p className="text-sm text-gray-600">
                {product.stockQuantity} units available
              </p>
            )}
          </div>

          {/* Short Description */}
          {product.shortDescription && (
            <div
              className="mb-8 text-gray-700"
              dangerouslySetInnerHTML={{ __html: product.shortDescription }}
            />
          )}

          {/* Add to Cart */}
          <div className="mb-8">
            <div className="flex gap-4 mb-4">
              <input
                type="number"
                min="1"
                defaultValue="1"
                className="w-20 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
                disabled={product.stockStatus === 'OUT_OF_STOCK'}
              >
                {product.stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Add to Cart'}
              </button>
            </div>
            <button className="w-full border-2 border-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-50 transition-colors font-semibold">
              Add to Wishlist
            </button>
          </div>

          {/* Product Meta */}
          <div className="border-t border-gray-200 pt-6 space-y-2 text-sm">
            {product.sku && (
              <p className="text-gray-600">
                <span className="font-semibold">SKU:</span> {product.sku}
              </p>
            )}
            {product.productCategories?.nodes && product.productCategories.nodes.length > 0 && (
              <p className="text-gray-600">
                <span className="font-semibold">Categories:</span>{' '}
                {product.productCategories.nodes.map((cat: any) => cat.name).join(', ')}
              </p>
            )}
            {product.productTags?.nodes && product.productTags.nodes.length > 0 && (
              <p className="text-gray-600">
                <span className="font-semibold">Tags:</span>{' '}
                {product.productTags.nodes.map((tag: any) => tag.name).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Product Description */}
      {product.description && (
        <div className="mt-16 border-t border-gray-200 pt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Product Description</h2>
          <div
            className="prose prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </div>
      )}
    </div>
  );
}
