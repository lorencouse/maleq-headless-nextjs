'use client';

import { useEffect } from 'react';

/**
 * Fires a beacon to /api/log-404 when the 404 page renders.
 * Captures the URL path that triggered the 404 for later diagnosis.
 */
export default function Log404() {
  useEffect(() => {
    const path = window.location.pathname + window.location.search;
    const referrer = document.referrer || '';

    // Use sendBeacon so the log fires even if the user navigates away quickly
    const data = JSON.stringify({ path, referrer });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/log-404', new Blob([data], { type: 'application/json' }));
    } else {
      fetch('/api/log-404', { method: 'POST', body: data, keepalive: true });
    }
  }, []);

  return null;
}
