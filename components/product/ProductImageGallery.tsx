'use client';

import { useState } from 'react';
import Image from 'next/image';

interface ProductImage {
  id: string;
  url: string;
  altText: string;
  title: string;
  isPrimary: boolean;
}

interface ProductImageGalleryProps {
  images: ProductImage[];
  productName: string;
}

export default function ProductImageGallery({ images, productName }: ProductImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState(images[0] || null);

  if (!images || images.length === 0) {
    return (
      <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-200">
        <div className="flex items-center justify-center h-full text-gray-400">
          No Image Available
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Image */}
      <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
        <Image
          src={selectedImage?.url || images[0].url}
          alt={selectedImage?.altText || productName}
          title={selectedImage?.title || productName}
          fill
          className="object-contain"
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
        />
      </div>

      {/* Thumbnail Grid */}
      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-4">
          {images.map((image) => (
            <button
              key={image.id}
              onClick={() => setSelectedImage(image)}
              className={`relative aspect-square rounded-lg overflow-hidden bg-gray-100 border-2 transition-all ${
                selectedImage?.id === image.id
                  ? 'border-blue-600 ring-2 ring-blue-600 ring-opacity-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Image
                src={image.url}
                alt={image.altText}
                title={image.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 25vw, 12.5vw"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
