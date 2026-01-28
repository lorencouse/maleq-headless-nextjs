'use client';

import { useState, useEffect } from 'react';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { showSuccess, showInfo } from '@/lib/utils/toast';

interface WishlistButtonProps {
  productId: string;
  name: string;
  slug: string;
  price: number;
  regularPrice?: number;
  image?: {
    url: string;
    altText: string;
  };
  inStock: boolean;
  variant?: 'icon' | 'button' | 'icon-text';
  className?: string;
}

export default function WishlistButton({
  productId,
  name,
  slug,
  price,
  regularPrice,
  image,
  inStock,
  variant = 'icon',
  className = '',
}: WishlistButtonProps) {
  const { toggleItem, isInWishlist, hydrate } = useWishlistStore();
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Hydrate on mount and sync state
  useEffect(() => {
    hydrate();
  }, []);

  // Keep local state in sync with store
  useEffect(() => {
    setIsWishlisted(isInWishlist(productId));
  }, [productId, isInWishlist]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    const wasAdded = toggleItem({
      productId,
      name,
      slug,
      price,
      regularPrice,
      image,
      inStock,
    });

    setIsWishlisted(wasAdded);

    if (wasAdded) {
      showSuccess('Added to wishlist');
    } else {
      showInfo('Removed from wishlist');
    }
  };

  const HeartIcon = ({ filled }: { filled: boolean }) => (
    <svg
      className={`w-5 h-5 transition-transform ${isAnimating ? 'scale-125' : 'scale-100'}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );

  if (variant === 'button') {
    return (
      <button
        onClick={handleToggle}
        className={`w-full flex items-center justify-center gap-2 py-3 px-6 border-2 rounded-lg font-semibold transition-colors ${
          isWishlisted
            ? 'border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
            : 'border-border text-foreground hover:bg-muted'
        } ${className}`}
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <HeartIcon filled={isWishlisted} />
        {isWishlisted ? 'In Wishlist' : 'Add to Wishlist'}
      </button>
    );
  }

  if (variant === 'icon-text') {
    return (
      <button
        onClick={handleToggle}
        className={`flex items-center gap-2 text-sm transition-colors ${
          isWishlisted
            ? 'text-red-500 hover:text-red-600'
            : 'text-muted-foreground hover:text-foreground'
        } ${className}`}
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <HeartIcon filled={isWishlisted} />
        <span>{isWishlisted ? 'Saved' : 'Save'}</span>
      </button>
    );
  }

  // Default: icon only
  // Check if explicit sizing is provided in className
  const hasExplicitSize = className.includes('w-') || className.includes('h-');

  return (
    <button
      onClick={handleToggle}
      className={`${hasExplicitSize ? 'flex items-center justify-center' : 'p-2'} rounded-full transition-colors ${
        isWishlisted
          ? 'text-red-500 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50'
          : 'text-muted-foreground hover:text-foreground bg-background/80 hover:bg-muted'
      } ${className}`}
      aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <HeartIcon filled={isWishlisted} />
    </button>
  );
}
