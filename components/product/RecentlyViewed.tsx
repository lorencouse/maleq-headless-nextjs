'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getRecentlyViewed, RecentlyViewedItem } from '@/lib/utils/recently-viewed';
import WishlistButton from '@/components/wishlist/WishlistButton';
import { useHorizontalScroll } from '@/lib/hooks/useHorizontalScroll';

interface RecentlyViewedProps {
  currentProductId?: string;
  title?: string;
  maxItems?: number;
}

export default function RecentlyViewed({
  currentProductId,
  title = 'Recently Viewed',
  maxItems = 8,
}: RecentlyViewedProps) {
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);
  const {
    scrollContainerRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    checkScroll,
  } = useHorizontalScroll({ cardWidth: 220 });

  useEffect(() => {
    const viewed = getRecentlyViewed();
    // Filter out current product and limit
    const filtered = viewed
      .filter((item) => item.productId !== currentProductId)
      .slice(0, maxItems);
    setItems(filtered);
  }, [currentProductId, maxItems]);

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-16 border-t border-border pt-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
        {items.length > 4 && (
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
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 -mx-4 px-4 snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="flex-shrink-0 w-[200px] snap-start"
          >
            <div className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow group">
              <Link href={`/product/${item.slug}`}>
                <div className="relative aspect-square bg-muted">
                  {item.image ? (
                    <Image
                      src={item.image.url}
                      alt={item.image.altText || item.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="200px"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No Image
                    </div>
                  )}

                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <WishlistButton
                      productId={item.productId}
                      name={item.name}
                      slug={item.slug}
                      price={item.price}
                      regularPrice={item.regularPrice}
                      image={item.image}
                      inStock={true}
                      variant="icon"
                    />
                  </div>
                </div>
              </Link>

              <div className="p-3">
                <div className="border-b-2 border-primary pb-2 mb-2">
                  <Link href={`/product/${item.slug}`}>
                    <h3 className="heading-plain font-medium text-sm text-foreground line-clamp-2 hover:text-primary transition-colors">
                      {item.name}
                    </h3>
                  </Link>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">
                    {formatPrice(item.price)}
                  </span>
                  {item.regularPrice && item.regularPrice > item.price && (
                    <span className="text-xs text-muted-foreground line-through">
                      {formatPrice(item.regularPrice)}
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
