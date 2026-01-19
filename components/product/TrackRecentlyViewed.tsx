'use client';

import { useEffect } from 'react';
import { addToRecentlyViewed } from '@/lib/utils/recently-viewed';

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
    }, 1000);

    return () => clearTimeout(timer);
  }, [productId, name, slug, price, regularPrice, image]);

  // This component doesn't render anything
  return null;
}
