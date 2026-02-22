'use client';

import { useEffect } from 'react';
import { event as gaEvent } from '@/lib/analytics/gtag';
import { flushQueue, getQueueSize } from '@/lib/analytics/offline-queue';

/**
 * Tracks PWA-specific analytics:
 * - Whether the user is in standalone (installed) or browser mode (once per session)
 * - Flushes queued offline analytics events when back online
 */
export default function PwaAnalytics() {
  // Track standalone vs browser mode once per session
  useEffect(() => {
    if (!sessionStorage.getItem('maleq-pwa-mode-tracked')) {
      sessionStorage.setItem('maleq-pwa-mode-tracked', '1');

      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

      gaEvent({
        action: 'pwa_mode',
        category: 'PWA',
        label: isStandalone ? 'standalone' : 'browser',
      });
    }
  }, []);

  // Flush offline analytics queue when coming back online
  useEffect(() => {
    const handleOnline = () => {
      const size = getQueueSize();
      if (size > 0) {
        // Small delay to let gtag script initialize
        setTimeout(() => flushQueue(), 1000);
      }
    };

    window.addEventListener('online', handleOnline);

    // Also flush on mount if online and there are queued events
    if (navigator.onLine) {
      handleOnline();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return null;
}
