'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import ProductCard from './ProductCard';
import { UnifiedProduct } from '@/lib/products/combined-service';

interface FeaturedProductsProps {
  products: UnifiedProduct[];
  title?: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllText?: string;
}

export default function FeaturedProducts({
  products,
  title = 'Featured Products',
  subtitle = 'Hand-picked favorites just for you',
  viewAllHref = '/shop',
  viewAllText = 'View All',
}: FeaturedProductsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollability = () => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 10
      );
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = container.clientWidth * 0.8;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
      // Check scrollability after animation
      setTimeout(checkScrollability, 300);
    }
  };

  if (products.length === 0) return null;

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Scroll Buttons - Hidden on mobile */}
          <div className="hidden sm:flex items-center gap-2 mr-4">
            <button
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              className="w-10 h-10 rounded-full border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Scroll left"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => scroll('right')}
              disabled={!canScrollRight}
              className="w-10 h-10 rounded-full border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Scroll right"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
          >
            {viewAllText}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Products Carousel */}
      <div className="relative">
        <div
          ref={scrollContainerRef}
          onScroll={checkScrollability}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {products.map((product) => (
            <div
              key={product.id}
              className="flex-shrink-0 w-[280px] sm:w-[300px] snap-start"
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>

        {/* Gradient Edges - Desktop Only */}
        <div className="hidden sm:block absolute top-0 left-0 bottom-4 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none opacity-0 transition-opacity" style={{ opacity: canScrollLeft ? 1 : 0 }} />
        <div className="hidden sm:block absolute top-0 right-0 bottom-4 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none opacity-0 transition-opacity" style={{ opacity: canScrollRight ? 1 : 0 }} />
      </div>
    </section>
  );
}

// Alternative grid layout for featured products (non-carousel)
export function FeaturedProductsGrid({
  products,
  title = 'Featured Products',
  subtitle = 'Hand-picked favorites just for you',
  viewAllHref = '/shop',
  viewAllText = 'View All',
  columns = 4,
}: FeaturedProductsProps & { columns?: 2 | 3 | 4 }) {
  if (products.length === 0) return null;

  const gridCols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>
        <Link
          href={viewAllHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
        >
          {viewAllText}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Products Grid */}
      <div className={`grid grid-cols-1 ${gridCols[columns]} gap-4 sm:gap-6`}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
