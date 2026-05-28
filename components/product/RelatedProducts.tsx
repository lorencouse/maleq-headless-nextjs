'use client';

import { useTranslations } from 'next-intl';
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
  title,
}: RelatedProductsProps) {
  const t = useTranslations('productRelated');
  // Filter out current product
  const filteredProducts = products.filter(
    (p) => p.id !== currentProductId && p.databaseId?.toString() !== currentProductId
  );

  return <ProductCarousel products={filteredProducts} title={title ?? t('youMayAlsoLikeTitle')} />;
}
