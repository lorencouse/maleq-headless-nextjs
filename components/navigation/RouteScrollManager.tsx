'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Scroll to the top on forward navigations while preserving native browser
 * back/forward restoration. This keeps "Back" behavior intact for history
 * entries without forcing the user to the top on popstate navigations.
 */
export default function RouteScrollManager() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);
  const preserveNextNavigation = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.history.scrollRestoration = 'auto';

    const handlePopState = () => {
      preserveNextNavigation.current = true;
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (preserveNextNavigation.current) {
      preserveNextNavigation.current = false;
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }, [pathname]);

  return null;
}
