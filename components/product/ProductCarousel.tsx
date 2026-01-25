'use client';

import { UnifiedProduct } from '@/lib/products/combined-service';
import ProductCard from '@/components/shop/ProductCard';
import { useHorizontalScroll } from '@/lib/hooks/useHorizontalScroll';

interface ProductCarouselProps {
  products: UnifiedProduct[];
  title: string;
  cardWidth?: number;
  minItemsForArrows?: number;
}

export default function ProductCarousel({
  products,
  title,
  cardWidth = 280,
  minItemsForArrows = 4,
}: ProductCarouselProps) {
  const {
    scrollContainerRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    checkScroll,
  } = useHorizontalScroll({ cardWidth });

  if (products.length === 0) {
    return null;
  }

  const showArrows = products.length > minItemsForArrows;

  return (
    <div className='mt-16 border-t border-border pt-12'>
      <h2 className='text-2xl font-bold text-foreground mb-6'>{title}</h2>

      <div className='relative pt-6'>
        {/* Left Arrow */}
        {showArrows && (
          <button
            onClick={scrollLeft}
            disabled={!canScrollLeft}
            className='absolute left-0 top-1/2 -translate-y-1/2 z-10 p-4 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted disabled:opacity-0 disabled:pointer-events-none transition-all'
            aria-label='Scroll left'
          >
            <svg
              className='w-6 h-6'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M15 19l-7-7 7-7'
              />
            </svg>
          </button>
        )}

        {/* Right Arrow */}
        {showArrows && (
          <button
            onClick={scrollRight}
            disabled={!canScrollRight}
            className='absolute right-0 top-1/2 -translate-y-1/2 z-10 p-4 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted disabled:opacity-0 disabled:pointer-events-none transition-all'
            aria-label='Scroll right'
          >
            <svg
              className='w-6 h-6'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M9 5l7 7-7 7'
              />
            </svg>
          </button>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className='flex gap-6 overflow-x-auto scrollbar-hide pb-4 px-8 snap-x snap-mandatory'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {products.map((product) => (
            <div
              key={product.id}
              className='flex-shrink-0 snap-start'
              style={{ width: `${cardWidth}px` }}
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
