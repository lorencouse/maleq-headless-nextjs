'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegistration() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Never run the service worker in development. With HMR + slow first-compiles,
    // the SW's network-first navigation handler times out (8s) and falls back to a
    // stale/partial cached document — which renders as a "wall of" raw RSC flight
    // text. So in dev we actively unregister any existing SW and purge its caches
    // (self-healing for browsers that registered it before this guard existed),
    // then bail. Production registers normally below.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if (typeof caches !== 'undefined') {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }

    let trimInterval: ReturnType<typeof setInterval> | undefined;
    let updateInterval: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // When a new SW is found, prompt user instead of force-reloading
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New SW installed but waiting — show update prompt
              setWaitingWorker(newWorker);
              setShowUpdateBanner(true);
            }
          });
        });

        // Periodically trim caches (every 5 minutes while page is open)
        trimInterval = setInterval(() => {
          registration.active?.postMessage('TRIM_CACHES');
        }, 5 * 60 * 1000);

        // Check for SW updates every hour (for long-lived tabs)
        updateInterval = setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch(() => {
        // Service worker registration failed — not critical
      });

    return () => {
      if (trimInterval) clearInterval(trimInterval);
      if (updateInterval) clearInterval(updateInterval);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      // Listen for the new SW to take control before reloading
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
      waitingWorker.postMessage('SKIP_WAITING');
      setShowUpdateBanner(false);
    }
  };

  if (!showUpdateBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-card border border-border rounded-lg shadow-lg p-4 max-w-sm flex items-center gap-3">
      <p className="text-sm text-foreground flex-1">
        A new version is available.
      </p>
      <button
        onClick={handleUpdate}
        className="text-sm font-medium text-primary hover:text-primary-hover transition-colors whitespace-nowrap"
      >
        Update now
      </button>
    </div>
  );
}
