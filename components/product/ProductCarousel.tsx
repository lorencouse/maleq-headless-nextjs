'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { UnifiedProduct } from '@/lib/products/combined-service';
import ProductCard from '@/components/shop/ProductCard';
import { useHorizontalScroll } from '@/lib/hooks/useHorizontalScroll';

interface ProductCarouselProps {
  products: UnifiedProduct[];
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  viewAllLink?: string;
  viewAllText?: string;
  cardWidth?: number;
  minItemsForArrows?: number;
  showGradients?: boolean;
  showMobileHint?: boolean;
  className?: string;
  variant?: 'default' | 'section';
}

export default function ProductCarousel({
  products,
  title,
  subtitle,
  badge,
  viewAllLink,
  viewAllText = 'View All',
  cardWidth = 280,
  minItemsForArrows = 4,
  showGradients = false,
  showMobileHint = false,
  className = '',
  variant = 'default',
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

  const wrapperClass = variant === 'default'
    ? 'mt-16 border-t border-border pt-12'
    : '';

  const content = (
    <div className={`${wrapperClass} ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          {badge && <div className="mb-1">{badge}</div>}
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h2>
          {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {viewAllLink && (
          <Link
            href={viewAllLink}
            className="text-primary hover:text-primary-hover font-medium flex items-center gap-1"
          >
            {viewAllText}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>

      {/* Carousel */}
      <div className="relative">
        {/* Gradient fade edges */}
        {showGradients && canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        )}
        {showGradients && canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
        )}

        {/* Overlay Arrows */}
        {showArrows && (
          <>
            <button
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-4 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted disabled:opacity-0 disabled:pointer-events-none transition-all hidden sm:block"
              aria-label="Scroll left"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={scrollRight}
              disabled={!canScrollRight}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-4 rounded-full bg-background/90 border border-border shadow-lg hover:bg-muted disabled:opacity-0 disabled:pointer-events-none transition-all hidden sm:block"
              aria-label="Scroll right"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className="flex gap-4 sm:gap-6 overflow-x-auto pb-4 snap-x snap-mandatory px-4 sm:px-8"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {products.map((product) => (
            <div
              key={product.id}
              className="flex-shrink-0 snap-start w-[260px] sm:w-[280px]"
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile scroll indicator */}
      {showMobileHint && (
        <div className="flex justify-center mt-4 gap-1 sm:hidden">
          <p className="text-xs text-muted-foreground">Swipe to see more</p>
          <svg
            className="w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ animation: 'bounce-x 1s ease-in-out infinite' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}

      <style jsx>{`
        @keyframes bounce-x {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );

  return content;
}
