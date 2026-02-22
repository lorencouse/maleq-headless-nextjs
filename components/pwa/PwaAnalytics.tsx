'use client';

import { useEffect } from 'react';
import { event as gaEvent } from '@/lib/analytics/gtag';

/**
 * Tracks PWA-specific analytics:
 * - Whether the user is in standalone (installed) or browser mode
 * - Sends a single event per session
 */
export default function PwaAnalytics() {
  useEffect(() => {
    // Only fire once per session
    if (sessionStorage.getItem('maleq-pwa-mode-tracked')) return;
    sessionStorage.setItem('maleq-pwa-mode-tracked', '1');

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

    gaEvent({
      action: 'pwa_mode',
      category: 'PWA',
      label: isStandalone ? 'standalone' : 'browser',
    });
  }, []);

  return null;
}
