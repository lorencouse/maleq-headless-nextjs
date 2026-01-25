'use client';

import { useState } from 'react';
import ProductImageGallery from './ProductImageGallery';
import ProductPageClient from './ProductPageClient';
import { EnhancedProduct } from '@/lib/products/product-service';
import { VariationImage } from '@/lib/types/product';

interface ProductDetailsWrapperProps {
  product: EnhancedProduct;
}

export default function ProductDetailsWrapper({ product }: ProductDetailsWrapperProps) {
  const [selectedVariationImage, setSelectedVariationImage] = useState<VariationImage | null>(null);

  // Prepare gallery images
  const galleryImages = product.gallery.map(img => ({
    ...img,
    title: img.altText,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
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
        {/* Brand and Category - moved from page.tsx */}
        <div className="mb-4 flex items-center gap-4">
          {/* Brand */}
          {product.brands && product.brands.length > 0 && (
            <a
              href={`/brand/${product.brands[0].slug}`}
              className="link-brand text-base"
            >
              {product.brands[0].name}
            </a>
          )}
          {/* Category */}
          {product.categories && product.categories.length > 0 && (
            <a
              href={`/product-category/${product.categories[0].slug}`}
              className="link-subtle text-sm !font-normal"
            >
              {product.categories[0].name}
            </a>
          )}
        </div>

        {/* Product Name */}
        <h1 className="text-4xl font-bold text-foreground mb-6">{product.name}</h1>

        {/* Client-side interactive components */}
        <ProductPageClient
          product={product}
          onVariationImageChange={setSelectedVariationImage}
        />
      </div>
    </div>
  );
}
