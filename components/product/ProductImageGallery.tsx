'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { VariationImage, GalleryProductImage } from '@/lib/types/product';

interface ProductImageGalleryProps {
  images: GalleryProductImage[];
  productName: string;
  selectedVariationImage?: VariationImage | null;
}

export default function ProductImageGallery({
  images,
  productName,
  selectedVariationImage
}: ProductImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState(images[0] || null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // When variation image changes, update the display
  useEffect(() => {
    if (selectedVariationImage) {
      // Create a temporary image object for the variation
      setSelectedImage({
        id: 'variation-image',
        url: selectedVariationImage.url,
        altText: selectedVariationImage.altText || productName,
        title: productName,
        isPrimary: false,
      });
    }
  }, [selectedVariationImage, productName]);

  // Check scroll buttons visibility
  useEffect(() => {
    const checkScroll = () => {
      const container = scrollContainerRef.current;
      if (container) {
        setCanScrollLeft(container.scrollLeft > 0);
        setCanScrollRight(
          container.scrollLeft < container.scrollWidth - container.clientWidth - 1
        );
      }
    };

    checkScroll();
    const container = scrollContainerRef.current;
    container?.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);

    return () => {
      container?.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [images]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  if (!images || images.length === 0) {
    return (
      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          No Image Available
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Image */}
      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
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

      {/* Thumbnail Carousel - Single Row */}
      {images.length > 1 && (
        <div className="relative group">
          {/* Left Scroll Button */}
          {canScrollLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-8 sm:h-8 bg-background/90 hover:bg-background border border-border rounded-full shadow-md flex items-center justify-center text-foreground hover:text-primary transition-colors"
              aria-label="Scroll left"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Scrollable Thumbnail Container */}
          <div
            ref={scrollContainerRef}
            className="flex gap-2 sm:gap-3 overflow-x-auto scrollbar-hide scroll-smooth px-1 py-1"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {images.map((image) => (
              <button
                key={image.id}
                onClick={() => setSelectedImage(image)}
                className={`relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted border-2 transition-all ${
                  selectedImage?.id === image.id
                    ? 'border-primary ring-2 ring-primary/50'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <Image
                  src={image.url}
                  alt={image.altText}
                  title={image.title}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </button>
            ))}
          </div>

          {/* Right Scroll Button */}
          {canScrollRight && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-8 sm:h-8 bg-background/90 hover:bg-background border border-border rounded-full shadow-md flex items-center justify-center text-foreground hover:text-primary transition-colors"
              aria-label="Scroll right"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
