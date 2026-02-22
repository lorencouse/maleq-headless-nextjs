'use client';

import { useEffect } from 'react';
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { GA_TRACKING_ID } from '@/lib/analytics/gtag';

/**
 * Reports Core Web Vitals to Google Analytics with a
 * `pwa_display_mode` dimension (standalone vs browser)
 * so you can compare performance between installed PWA and browser.
 */
export default function WebVitals() {
  useEffect(() => {
    if (!GA_TRACKING_ID || typeof window.gtag !== 'function') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

    const displayMode = isStandalone ? 'standalone' : 'browser';

    function sendToGA(metric: Metric) {
      window.gtag('event', metric.name, {
        event_category: 'Web Vitals',
        event_label: metric.id,
        value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
        non_interaction: true,
        pwa_display_mode: displayMode,
      });
    }

    onCLS(sendToGA);
    onINP(sendToGA);
    onLCP(sendToGA);
    onFCP(sendToGA);
    onTTFB(sendToGA);
  }, []);

  return null;
}
