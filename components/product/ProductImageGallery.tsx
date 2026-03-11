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
  const [mainImageLoaded, setMainImageLoaded] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

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

  // Close lightbox on ESC
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsLightboxOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isLightboxOpen]);

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

  const navigateLightbox = useCallback((direction: 'prev' | 'next') => {
    const currentIndex = images.findIndex(img => img.url === selectedImage?.url);
    if (currentIndex === -1) return;
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % images.length
      : (currentIndex - 1 + images.length) % images.length;
    setSelectedImage(images[newIndex]);
    setMainImageLoaded(false);
  }, [images, selectedImage]);

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
          imageUrl: selectedImage.url,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed (${res.status}): ${body}`);
      }
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

  const currentImageUrl = selectedImage?.url || images[0].url;

  return (
    <div className="space-y-4">
      {/* Main Image / Video */}
      <div
        className="relative aspect-square rounded-lg overflow-hidden bg-muted cursor-zoom-in group/main"
        onClick={() => {
          if (!isVideo(currentImageUrl)) {
            setIsLightboxOpen(true);
          }
        }}
      >
        {isVideo(currentImageUrl) ? (
          <video
            src={currentImageUrl}
            controls
            playsInline
            className="w-full h-full object-contain"
          />
        ) : failedImages.has(currentImageUrl) ? (
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
              src={currentImageUrl}
              alt={selectedImage?.altText || productName}
              title={selectedImage?.title || productName}
              fill
              className={`object-contain transition-opacity duration-200 ${mainImageLoaded ? 'opacity-100' : 'opacity-0'}`}
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              onError={() => handleImageError(currentImageUrl)}
              onLoad={() => setMainImageLoaded(true)}
            />
            {/* Zoom hint */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-sm text-white text-xs rounded-full opacity-0 group-hover/main:opacity-100 transition-opacity pointer-events-none">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              Tap to zoom
            </div>
          </>
        )}
        {showSetDefault && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSetDefault();
            }}
            disabled={isSettingDefault}
            className="absolute bottom-2 left-2 z-10 px-3 py-1.5 text-xs font-medium rounded-full bg-purple-600 hover:bg-purple-700 text-white shadow-md transition-colors disabled:opacity-50"
          >
            {isSettingDefault ? 'Setting\u2026' : 'Set as Default'}
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

      {/* Lightbox / Zoom Modal */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setIsLightboxOpen(false)}
        >
          {/* Close button */}
          <button
            onClick={() => setIsLightboxOpen(false)}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close zoom"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Navigation arrows */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox('prev'); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Previous image"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox('next'); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Next image"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Full-size image */}
          <div
            className="relative w-[90vw] h-[85vh] max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={currentImageUrl}
              alt={selectedImage?.altText || productName}
              fill
              className="object-contain"
              sizes="90vw"
              quality={90}
            />
          </div>

          {/* Image counter */}
          {images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 backdrop-blur-sm text-white text-sm rounded-full">
              {(images.findIndex(img => img.url === selectedImage?.url) + 1) || 1} / {images.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
