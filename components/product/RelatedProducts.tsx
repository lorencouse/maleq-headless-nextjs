'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { UnifiedProduct } from '@/lib/products/combined-service';
import WishlistButton from '@/components/wishlist/WishlistButton';

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Filter out current product
  const filteredProducts = products.filter(
    (p) => p.id !== currentProductId && p.databaseId?.toString() !== currentProductId
  );

  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 10
      );
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [filteredProducts]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const cardWidth = 280; // Approximate card width
      const scrollAmount = direction === 'left' ? -cardWidth * 2 : cardWidth * 2;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const formatPrice = (price: string | null | undefined) => {
    if (!price) return 'N/A';
    if (price.startsWith('$')) return price;
    const num = parseFloat(price.replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 'N/A' : `$${num.toFixed(2)}`;
  };

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
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              className="p-2 rounded-full border border-input hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Scroll left"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => scroll('right')}
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
              <Link href={`/shop/product/${product.slug}`}>
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
                      price={parseFloat(product.price?.replace(/[^0-9.]/g, '') || '0')}
                      regularPrice={parseFloat(product.regularPrice?.replace(/[^0-9.]/g, '') || '0')}
                      image={product.image || undefined}
                      inStock={product.stockStatus === 'IN_STOCK'}
                      variant="icon"
                    />
                  </div>
                </div>
              </Link>

              <div className="p-4">
                <Link href={`/shop/product/${product.slug}`}>
                  <h3 className="font-medium text-foreground line-clamp-2 hover:text-primary transition-colors mb-2">
                    {product.name}
                  </h3>
                </Link>

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
