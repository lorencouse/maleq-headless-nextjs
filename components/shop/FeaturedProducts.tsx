'use client';

import Link from 'next/link';
import ProductCard from './ProductCard';
import ProductCarousel from '@/components/product/ProductCarousel';
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
  if (products.length === 0) return null;

  return (
    <section className="mb-10">
      <ProductCarousel
        products={products}
        title={title}
        subtitle={subtitle}
        viewAllLink={viewAllHref}
        viewAllText={viewAllText}
        showGradients
        variant="section"
      />
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
