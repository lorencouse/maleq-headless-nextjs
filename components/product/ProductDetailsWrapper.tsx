'use client';

import { useState, useMemo, useCallback } from 'react';
import ProductImageGallery from './ProductImageGallery';
import ProductPageClient from './ProductPageClient';
import type { EnhancedProduct } from '@/lib/products/product-service';
import { findDefaultVariation } from '@/lib/products/variation-utils';
import { VariationImage } from '@/lib/types/product';

interface ProductDetailsWrapperProps {
  product: EnhancedProduct;
}

// Get the initial variation image for variable products
// Must match the logic in VariationSelector to stay in sync
function getInitialVariationImage(
  product: EnhancedProduct,
): VariationImage | null {
  if (
    product.type !== 'VARIABLE' ||
    !product.variations ||
    product.variations.length === 0
  ) {
    return null;
  }

  const initialVariation = findDefaultVariation(
    product.variations,
    product.defaultAttributes,
  );

  return initialVariation?.image || null;
}

export default function ProductDetailsWrapper({
  product,
}: ProductDetailsWrapperProps) {
  // Initialize with first variation's image for variable products
  const [selectedVariationImage, setSelectedVariationImage] =
    useState<VariationImage | null>(() => getInitialVariationImage(product));

  // Track externally-selected variation (from gallery thumbnail click)
  const [externalSelectedVariationId, setExternalSelectedVariationId] =
    useState<string | null>(null);

  // Build image URL → variation ID mapping for gallery thumbnails
  const variationImageMap = useMemo(() => {
    if (product.type !== 'VARIABLE' || !product.variations?.length) return undefined;

    const map: { url: string; variationId: string }[] = [];
    for (const v of product.variations) {
      if (v.image?.url) {
        map.push({ url: v.image.url, variationId: v.id });
      }
    }
    return map.length > 0 ? map : undefined;
  }, [product.type, product.variations]);

  // Handle gallery thumbnail selecting a variation
  const handleGalleryVariationSelect = useCallback((variationId: string) => {
    setExternalSelectedVariationId(variationId);

    // Also update the variation image immediately
    const variation = product.variations?.find(v => v.id === variationId);
    if (variation?.image) {
      setSelectedVariationImage(variation.image);
    }
  }, [product.variations]);

  // Prepare gallery images
  const galleryImages = product.gallery.map((img) => ({
    ...img,
    title: img.altText,
  }));

  return (
    <div className='grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-12'>
      {/* Product Images */}
      <div>
        <ProductImageGallery
          images={galleryImages}
          productName={product.name}
          selectedVariationImage={selectedVariationImage}
          variationImageMap={variationImageMap}
          onVariationSelectByImage={handleGalleryVariationSelect}
          productDatabaseId={product.databaseId}
        />
      </div>

      {/* Product Details */}
      <div>
        {/* Brand */}
        {product.brands && product.brands.length > 0 && (
          <div className='mb-4'>
            <a
              href={`/brand/${product.brands[0].slug}`}
              className='link-brand text-base'
            >
              {product.brands[0].name}
            </a>
          </div>
        )}

        {/* Product Name */}
        <h1 className='text-xl sm:text-2xl lg:text-3xl'>{product.name}</h1>

        {/* Client-side interactive components */}
        <ProductPageClient
          product={product}
          onVariationImageChange={setSelectedVariationImage}
          primaryCategory={product.categories?.[0]}
          externalSelectedVariationId={externalSelectedVariationId}
        />
      </div>
    </div>
  );
}
