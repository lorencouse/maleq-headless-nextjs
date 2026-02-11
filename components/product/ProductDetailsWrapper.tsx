'use client';

import { useState } from 'react';
import ProductImageGallery from './ProductImageGallery';
import ProductPageClient from './ProductPageClient';
import { EnhancedProduct } from '@/lib/products/product-service';
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

  // Find the first in-stock variation (matching VariationSelector's logic)
  const initialVariation =
    product.variations.find(
      (v) => v.stockStatus === 'IN_STOCK' || v.stockStatus === 'LOW_STOCK',
    ) || product.variations[0];

  return initialVariation?.image || null;
}

export default function ProductDetailsWrapper({
  product,
}: ProductDetailsWrapperProps) {
  // Initialize with first variation's image for variable products
  const [selectedVariationImage, setSelectedVariationImage] =
    useState<VariationImage | null>(() => getInitialVariationImage(product));

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
        />
      </div>
    </div>
  );
}
