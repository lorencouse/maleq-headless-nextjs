import Link from 'next/link';
import Image from 'next/image';
import { UnifiedProduct } from '@/lib/products/combined-service';

interface ProductCardProps {
  product: UnifiedProduct;
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
              src={product.image.url}
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
          {/* Category or Manufacturer */}
          <div className="mb-2 flex items-center gap-2">
            {product.category && (
              <span className="text-xs text-muted">
                {product.category.name}
              </span>
            )}
            {product.manufacturer && (
              <>
                {product.category && <span className="text-xs text-muted">•</span>}
                <span className="text-xs text-muted">
                  {product.manufacturer.name}
                </span>
              </>
            )}
          </div>

          {/* Product Name */}
          <h3 className="text-lg font-semibold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
            {product.name}
          </h3>

          {/* Short Description */}
          {product.shortDescription && (
            <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {product.shortDescription.replace(/<[^>]*>/g, '')}
            </div>
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

          {/* Stock Status */}
          {product.stockStatus === 'LOW_STOCK' && product.stockQuantity && (
            <div className="mt-2 text-xs text-warning">
              Only {product.stockQuantity} left in stock
            </div>
          )}

          {/* Variation Count */}
          {product.isVariableProduct && product.variationCount && product.variationCount > 0 && (
            <div className="mt-2 text-xs text-primary font-medium">
              {product.variationCount} {product.variationCount === 1 ? 'option' : 'options'} available
            </div>
          )}

          {product.source === 'WILLIAMS_TRADING' && product.sku && (
            <div className="mt-2 text-xs text-muted">
              SKU: {product.sku}
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
          {product.stockStatus === 'OUT_OF_STOCK'
            ? 'Out of Stock'
            : product.isVariableProduct
              ? 'Select Options'
              : 'Add to Cart'}
        </button>
      </div>
    </div>
  );
}
