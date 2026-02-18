'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { VariationImage, GalleryProductImage } from '@/lib/types/product';

interface VariationImageMapping {
  url: string;
  variationId: string;
}

interface ProductImageGalleryProps {
  images: GalleryProductImage[];
  productName: string;
  selectedVariationImage?: VariationImage | null;
  variationImageMap?: VariationImageMapping[];
  onVariationSelectByImage?: (variationId: string) => void;
  productDatabaseId?: number;
}

const isVideo = (url: string) => /\.(mp4|webm|mov|avi|ogv)(\?|$)/i.test(url);

export default function ProductImageGallery({
  images,
  productName,
  selectedVariationImage,
  variationImageMap,
  onVariationSelectByImage,
  productDatabaseId,
}: ProductImageGalleryProps) {
  const router = useRouter();
  const [selectedImage, setSelectedImage] = useState(images[0] || null);
  const [mainImageLoaded, setMainImageLoaded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  const handleImageError = useCallback((imageUrl: string) => {
    setFailedImages(prev => new Set(prev).add(imageUrl));
  }, []);

  // When a thumbnail is clicked, also select the matching variation if one exists
  const handleThumbnailClick = useCallback((image: GalleryProductImage) => {
    if (image.url !== selectedImage?.url) {
      setMainImageLoaded(false);
    }
    setSelectedImage(image);

    if (variationImageMap && onVariationSelectByImage) {
      // Normalize URLs for comparison (strip protocol, trailing slashes, query params)
      const normalize = (url: string) =>
        url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
      const clickedNorm = normalize(image.url);
      const match = variationImageMap.find(m => normalize(m.url) === clickedNorm);
      if (match) {
        onVariationSelectByImage(match.variationId);
      }
    }
  }, [variationImageMap, onVariationSelectByImage]);

  // When variation image changes, update the display
  useEffect(() => {
    if (selectedVariationImage) {
      setMainImageLoaded(false);
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

  const isDev = process.env.NODE_ENV === 'development';
  const showSetDefault =
    isDev &&
    productDatabaseId &&
    selectedImage &&
    !selectedImage.isPrimary &&
    selectedImage.id !== 'variation-image';

  const handleSetDefault = useCallback(async () => {
    if (!productDatabaseId || !selectedImage) return;
    setIsSettingDefault(true);
    try {
      const res = await fetch('/api/dev/set-default-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: productDatabaseId,
          imageId: parseInt(selectedImage.id, 10),
        }),
      });
      if (!res.ok) throw new Error('Failed to set default image');
      router.refresh();
    } catch (err) {
      console.error('Set default image error:', err);
    } finally {
      setIsSettingDefault(false);
    }
  }, [productDatabaseId, selectedImage, router]);

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
      {/* Main Image / Video */}
      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
        {isVideo(selectedImage?.url || images[0].url) ? (
          <video
            src={selectedImage?.url || images[0].url}
            controls
            playsInline
            className="w-full h-full object-contain"
          />
        ) : failedImages.has(selectedImage?.url || images[0].url) ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Image unavailable
          </div>
        ) : (
          <>
            {!mainImageLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            <Image
              src={selectedImage?.url || images[0].url}
              alt={selectedImage?.altText || productName}
              title={selectedImage?.title || productName}
              fill
              className={`object-contain transition-opacity duration-200 ${mainImageLoaded ? 'opacity-100' : 'opacity-0'}`}
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              onError={() => handleImageError(selectedImage?.url || images[0].url)}
              onLoad={() => setMainImageLoaded(true)}
            />
          </>
        )}
        {showSetDefault && (
          <button
            onClick={handleSetDefault}
            disabled={isSettingDefault}
            className="absolute bottom-2 left-2 z-10 px-3 py-1.5 text-xs font-medium rounded-full bg-purple-600 hover:bg-purple-700 text-white shadow-md transition-colors disabled:opacity-50"
          >
            {isSettingDefault ? 'Setting…' : 'Set as Default'}
          </button>
        )}
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
                onClick={() => handleThumbnailClick(image)}
                className={`relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted border-2 transition-all ${
                  selectedImage?.id === image.id
                    ? 'border-primary ring-2 ring-primary/50'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                {isVideo(image.url) ? (
                  <div className="relative w-full h-full bg-muted flex items-center justify-center">
                    <svg className="w-8 h-8 text-foreground/60" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                ) : failedImages.has(image.url) ? (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                    N/A
                  </div>
                ) : (
                  <Image
                    src={image.url}
                    alt={image.altText}
                    title={image.title}
                    fill
                    className="object-cover"
                    sizes="80px"
                    onError={() => handleImageError(image.url)}
                  />
                )}
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
