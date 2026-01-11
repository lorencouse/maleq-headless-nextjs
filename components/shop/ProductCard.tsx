import Link from 'next/link';
import Image from 'next/image';
import { Product } from '@/lib/types/woocommerce';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const formatPrice = (price: string | undefined) => {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all group">
      <Link href={`/shop/product/${product.slug}`}>
        {/* Product Image */}
        <div className="relative h-64 w-full overflow-hidden bg-input">
          {product.image ? (
            <Image
              src={product.image.sourceUrl}
              alt={product.image.altText || product.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted">
              No Image
            </div>
          )}

          {/* Sale Badge */}
          {product.onSale && (
            <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded">
              SALE
            </div>
          )}

          {/* Stock Status Badge */}
          {product.stockStatus === 'OUT_OF_STOCK' && (
            <div className="absolute top-2 left-2 bg-foreground text-background text-xs font-bold px-2 py-1 rounded">
              OUT OF STOCK
            </div>
          )}
        </div>

        <div className="p-4">
          {/* Categories */}
          {product.productCategories && product.productCategories.length > 0 && (
            <div className="mb-2">
              <span className="text-xs text-muted">
                {product.productCategories[0].name}
              </span>
            </div>
          )}

          {/* Product Name */}
          <h3 className="text-lg font-semibold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
            {product.name}
          </h3>

          {/* Short Description */}
          {product.shortDescription && (
            <div
              className="text-sm text-muted-foreground mb-3 line-clamp-2"
              dangerouslySetInnerHTML={{ __html: product.shortDescription }}
            />
          )}

          {/* Price */}
          <div className="flex items-center gap-2">
            {product.onSale && product.regularPrice ? (
              <>
                <span className="text-lg font-bold text-primary">
                  {formatPrice(product.salePrice)}
                </span>
                <span className="text-sm text-muted line-through">
                  {formatPrice(product.regularPrice)}
                </span>
              </>
            ) : (
              <span className="text-lg font-bold text-foreground">
                {formatPrice(product.price || product.regularPrice)}
              </span>
            )}
          </div>

          {/* Rating */}
          {product.averageRating && product.averageRating > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className={`h-4 w-4 ${
                      i < Math.floor(product.averageRating!)
                        ? 'text-warning'
                        : 'text-muted'
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              {product.reviewCount && product.reviewCount > 0 && (
                <span className="text-xs text-muted">
                  ({product.reviewCount})
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Add to Cart Button */}
      <div className="p-4 pt-0">
        <button
          className="w-full bg-primary text-primary-foreground py-2 px-4 rounded-md hover:bg-primary-hover transition-colors disabled:bg-muted disabled:cursor-not-allowed"
          disabled={product.stockStatus === 'OUT_OF_STOCK'}
        >
          {product.stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Add to Cart'}
        </button>
      </div>
    </div>
  );
}
