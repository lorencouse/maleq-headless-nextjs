'use client';

import { UnifiedProduct } from '@/lib/products/combined-service';
import ProductCarousel from './ProductCarousel';

interface RelatedProductsProps {
  products: UnifiedProduct[];
  currentProductId?: string;
  title?: string;
}

export default function RelatedProducts({
  products,
  currentProductId,
  title = 'You May Also Like',
}: RelatedProductsProps) {
  // Filter out current product
  const filteredProducts = products.filter(
    (p) => p.id !== currentProductId && p.databaseId?.toString() !== currentProductId
  );

  return <ProductCarousel products={filteredProducts} title={title} />;
}
