'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // When a new SW is found, activate it immediately
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'activated' &&
              navigator.serviceWorker.controller
            ) {
              // New SW activated — reload for fresh caches
              window.location.reload();
            }
          });
        });

        // Periodically trim caches (every 5 minutes while page is open)
        const trimInterval = setInterval(() => {
          registration.active?.postMessage('TRIM_CACHES');
        }, 5 * 60 * 1000);

        return () => clearInterval(trimInterval);
      })
      .catch(() => {
        // Service worker registration failed — not critical
      });
  }, []);

  return null;
}
