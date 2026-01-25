'use client';

import { useState, useEffect } from 'react';
import { getRecentlyViewed, RecentlyViewedItem } from '@/lib/utils/recently-viewed';
import { UnifiedProduct } from '@/lib/products/combined-service';
import ProductCarousel from './ProductCarousel';

// Convert RecentlyViewedItem to UnifiedProduct format for ProductCard
function toUnifiedProduct(item: RecentlyViewedItem): UnifiedProduct {
  const onSale = item.regularPrice ? item.regularPrice > item.price : false;
  return {
    id: item.id,
    databaseId: parseInt(item.productId) || undefined,
    name: item.name,
    slug: item.slug,
    description: null,
    shortDescription: null,
    sku: null,
    price: `$${item.price.toFixed(2)}`,
    regularPrice: item.regularPrice ? `$${item.regularPrice.toFixed(2)}` : null,
    salePrice: onSale ? `$${item.price.toFixed(2)}` : null,
    onSale,
    stockStatus: 'IN_STOCK',
    stockQuantity: null,
    image: item.image || null,
    categories: [],
    type: 'SIMPLE',
  };
}

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
  const [products, setProducts] = useState<UnifiedProduct[]>([]);

  useEffect(() => {
    const viewed = getRecentlyViewed();
    // Filter out current product, limit, and convert to UnifiedProduct
    const filtered = viewed
      .filter((item) => item.productId !== currentProductId)
      .slice(0, maxItems)
      .map(toUnifiedProduct);
    setProducts(filtered);
  }, [currentProductId, maxItems]);

  return <ProductCarousel products={products} title={title} />;
}
