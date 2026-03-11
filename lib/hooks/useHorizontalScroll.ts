'use client';

import { useState, useRef, useEffect, useCallback, RefObject } from 'react';

interface UseHorizontalScrollOptions {
  cardWidth?: number;
  scrollMultiplier?: number;
  threshold?: number;
}

interface UseHorizontalScrollReturn {
  scrollContainerRef: RefObject<HTMLDivElement>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
  checkScroll: () => void;
}

export function useHorizontalScroll(
  options: UseHorizontalScrollOptions = {}
): UseHorizontalScrollReturn {
  const {
    cardWidth = 280,
    scrollMultiplier = 2,
    threshold = 10,
  } = options;

  const scrollContainerRef = useRef<HTMLDivElement>(null!);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - threshold
      );
    }
  }, [threshold]);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = direction === 'left'
      ? -cardWidth * scrollMultiplier
      : cardWidth * scrollMultiplier;

    const maxScroll = container.scrollWidth - container.clientWidth;

    // Wrap around at edges
    if (direction === 'right' && container.scrollLeft >= maxScroll - threshold) {
      container.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (direction === 'left' && container.scrollLeft <= threshold) {
      container.scrollTo({ left: maxScroll, behavior: 'smooth' });
    } else {
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  }, [cardWidth, scrollMultiplier, threshold]);

  const scrollLeft = useCallback(() => scroll('left'), [scroll]);
  const scrollRight = useCallback(() => scroll('right'), [scroll]);

  return {
    scrollContainerRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    checkScroll,
  };
}

export default useHorizontalScroll;
