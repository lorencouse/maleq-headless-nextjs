'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { UnifiedProduct } from '@/lib/products/combined-service';
import QuickAddButton from './QuickAddButton';
import WishlistButton from '@/components/wishlist/WishlistButton';
import QuickViewModal from '@/components/product/QuickViewModal';
import { formatPrice, parsePrice } from '@/lib/utils/woocommerce-format';

interface ProductCardProps {
  product: UnifiedProduct;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Get first category
  const primaryCategory = product.categories?.[0];
  const isVariable = product.type === 'VARIABLE';

  return (
    <div className="bg-card border border-border rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all group">
      <Link href={`/product/${product.slug}`}>
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
            <div className="flex items-center justify-center h-full text-muted-foreground">
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

          {/* Quick Actions */}
          <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Quick View Button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsQuickViewOpen(true);
              }}
              className="p-2 rounded-full bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Quick view"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>

            {/* Wishlist Button */}
            <WishlistButton
              productId={product.databaseId?.toString() || product.id}
              name={product.name}
              slug={product.slug}
              price={parsePrice(product.price)}
              regularPrice={parsePrice(product.regularPrice)}
              image={product.image || undefined}
              inStock={product.stockStatus === 'IN_STOCK'}
              variant="icon"
            />
          </div>
        </div>

        <div className="p-4">
          {/* Category */}
          {primaryCategory && (
            <div className="mb-2">
              <span className="text-xs text-muted-foreground">
                {primaryCategory.name}
              </span>
            </div>
          )}

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
                <span className="text-sm text-muted-foreground line-through">
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
          {isVariable && product.variations && product.variations.length > 0 && (
            <div className="mt-2 text-xs text-primary font-medium">
              {product.variations.length} {product.variations.length === 1 ? 'option' : 'options'} available
            </div>
          )}

          {product.sku && (
            <div className="mt-2 text-xs text-muted-foreground">
              SKU: {product.sku}
            </div>
          )}
        </div>
      </Link>

      {/* Add to Cart Button */}
      <div className="p-4 pt-0">
        <QuickAddButton product={product} />
      </div>

      {/* Quick View Modal */}
      <QuickViewModal
        product={product}
        isOpen={isQuickViewOpen}
        onClose={() => setIsQuickViewOpen(false)}
      />
    </div>
  );
}
