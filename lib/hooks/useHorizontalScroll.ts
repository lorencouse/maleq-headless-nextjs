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
    if (container) {
      const scrollAmount = direction === 'left'
        ? -cardWidth * scrollMultiplier
        : cardWidth * scrollMultiplier;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  }, [cardWidth, scrollMultiplier]);

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
