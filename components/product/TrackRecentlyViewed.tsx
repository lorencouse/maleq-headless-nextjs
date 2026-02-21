'use client';

import { useEffect } from 'react';
import { addToRecentlyViewed } from '@/lib/utils/recently-viewed';
import { saveProductOffline } from '@/lib/pwa/offline-products';

interface TrackRecentlyViewedProps {
  productId: string;
  name: string;
  slug: string;
  price: number;
  regularPrice?: number;
  image?: {
    url: string;
    altText: string;
  };
  // Extra fields for offline product storage
  salePrice?: string | null;
  shortDescription?: string | null;
  categories?: string[];
  brand?: string | null;
}

/**
 * Component that tracks when a product is viewed
 * Add this to product pages to record the view
 */
export default function TrackRecentlyViewed({
  productId,
  name,
  slug,
  price,
  regularPrice,
  image,
  salePrice,
  shortDescription,
  categories,
  brand,
}: TrackRecentlyViewedProps) {
  useEffect(() => {
    // Add to recently viewed after a small delay to ensure page is fully loaded
    const timer = setTimeout(() => {
      addToRecentlyViewed({
        id: `recent-${productId}`,
        productId,
        name,
        slug,
        price,
        regularPrice,
        image,
      });

      // Save to IndexedDB for offline access
      saveProductOffline({
        slug,
        productId,
        name,
        price: price ? `$${price.toFixed(2)}` : null,
        regularPrice: regularPrice ? `$${regularPrice.toFixed(2)}` : null,
        salePrice: salePrice || null,
        shortDescription: shortDescription || null,
        image: image || null,
        categories: categories || [],
        brand: brand || null,
        savedAt: Date.now(),
      });

      // Track server-side view count (fire-and-forget)
      const numericId = parseInt(productId, 10);
      if (numericId > 0) {
        fetch('/api/products/track-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: numericId }),
        }).catch(() => {});
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [productId, name, slug, price, regularPrice, image, salePrice, shortDescription, categories, brand]);

  // This component doesn't render anything
  return null;
}
