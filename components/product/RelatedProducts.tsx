'use client';

import Link from 'next/link';
import Image from 'next/image';
import { UnifiedProduct } from '@/lib/products/combined-service';
import WishlistButton from '@/components/wishlist/WishlistButton';
import { useHorizontalScroll } from '@/lib/hooks/useHorizontalScroll';
import { formatPrice, parsePrice } from '@/lib/utils/woocommerce-format';

interface RelatedProductsProps {
  products: UnifiedProduct[];
  currentProductId?: string;
  title?: string;
}

export default function RelatedProducts({
  products,
  currentProductId,
  title = 'Related Products',
}: RelatedProductsProps) {
  const {
    scrollContainerRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    checkScroll,
  } = useHorizontalScroll({ cardWidth: 280 });

  // Filter out current product
  const filteredProducts = products.filter(
    (p) => p.id !== currentProductId && p.databaseId?.toString() !== currentProductId
  );

  if (filteredProducts.length === 0) {
    return null;
  }

  return (
    <div className="mt-16 border-t border-border pt-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
        {filteredProducts.length > 4 && (
          <div className="flex gap-2">
            <button
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              className="p-2 rounded-full border border-input hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Scroll left"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={scrollRight}
              disabled={!canScrollRight}
              className="p-2 rounded-full border border-input hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Scroll right"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex gap-6 overflow-x-auto scrollbar-hide pb-4 -mx-4 px-4 snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {filteredProducts.map((product) => (
          <div
            key={product.id}
            className="flex-shrink-0 w-[260px] snap-start"
          >
            <div className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow group">
              <Link href={`/product/${product.slug}`}>
                <div className="relative aspect-square bg-muted">
                  {product.image ? (
                    <Image
                      src={product.image.url}
                      alt={product.image.altText || product.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="260px"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      No Image
                    </div>
                  )}

                  {product.onSale && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded">
                      SALE
                    </div>
                  )}

                  {product.stockStatus === 'OUT_OF_STOCK' && (
                    <div className="absolute top-2 left-2 bg-foreground text-background text-xs font-bold px-2 py-1 rounded">
                      OUT OF STOCK
                    </div>
                  )}

                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
              </Link>

              <div className="p-4">
                <div className="border-b-2 border-primary pb-2 mb-2">
                  <Link href={`/product/${product.slug}`}>
                    <h3 className="heading-plain font-medium text-foreground line-clamp-2 hover:text-primary transition-colors">
                      {product.name}
                    </h3>
                  </Link>
                </div>

                <div className="flex items-center gap-2">
                  {product.onSale && product.regularPrice ? (
                    <>
                      <span className="font-bold text-primary">
                        {formatPrice(product.salePrice)}
                      </span>
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(product.regularPrice)}
                      </span>
                    </>
                  ) : (
                    <span className="font-bold text-foreground">
                      {formatPrice(product.price || product.regularPrice)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
