// ─── Cache Configuration ────────────────────────────────────────────
const CACHE_VERSION = 'v3';
const CACHE_PREFIX = 'maleq';

const CACHES = {
  precache: `${CACHE_PREFIX}-precache-${CACHE_VERSION}`,
  pages: `${CACHE_PREFIX}-pages-${CACHE_VERSION}`,
  static: `${CACHE_PREFIX}-static-${CACHE_VERSION}`,
  images: `${CACHE_PREFIX}-images-${CACHE_VERSION}`,
  api: `${CACHE_PREFIX}-api-${CACHE_VERSION}`,
};

const ALL_CACHE_NAMES = Object.values(CACHES);

// Critical resources that MUST be precached — install fails if these fail
const CRITICAL_PRECACHE = ['/offline.html'];

// Nice-to-have precache — install succeeds even if these fail
const OPTIONAL_PRECACHE = ['/', '/shop'];

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Offline | Male Q</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem; color: #111; background: #fff; }
    main { max-width: 560px; margin: 10vh auto 0; }
    h1 { margin-bottom: .5rem; }
    p { color: #444; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>You're offline</h1>
    <p>We couldn't load this page right now. Reconnect and try again.</p>
  </main>
</body>
</html>`;

// Cache size limits
const LIMITS = {
  pages: 50,
  images: 200,
  api: 100,
  static: 100,
};

// Max cache age (ms)
const MAX_AGE = {
  pages: 24 * 60 * 60 * 1000,      // 1 day
  api: 60 * 60 * 1000,              // 1 hour
  images: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// ─── Helpers ────────────────────────────────────────────────────────

// Trim a cache to maxEntries, evicting oldest first
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await Promise.all(
      keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key))
    );
  }
}

// Check if a cached response has expired based on its Date header
function isExpired(response, maxAgeMs) {
  const dateHeader = response.headers.get('date');
  if (!dateHeader) return false;
  const age = Date.now() - new Date(dateHeader).getTime();
  return age > maxAgeMs;
}

// Stale-while-revalidate: return cached immediately, update in background
function staleWhileRevalidate(event, cacheName) {
  event.respondWith(
    caches.open(cacheName).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetched = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cached || new Response('Service Unavailable', { status: 503 }));

        return cached || fetched;
      })
    )
  );
}

// Network-first: try network, fall back to cache (with age check)
function networkFirst(event, cacheName, maxAgeMs) {
  event.respondWith(
    fetchWithTimeout(event.request, 5000)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          // If cached response exists but is expired, don't serve stale data
          if (cached && maxAgeMs && isExpired(cached, maxAgeMs)) {
            return new Response('Service Unavailable', { status: 503 });
          }
          return cached || new Response('Service Unavailable', { status: 503 });
        })
      )
  );
}

// Cache-first: serve from cache, fetch on miss
function cacheFirst(event, cacheName) {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
}

// Fetch with timeout — races fetch() against a timer, rejects on timeout
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Network timeout'));
    }, ms);

    fetch(request, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── URL Matchers ───────────────────────────────────────────────────

// API routes that should NEVER be cached (auth, payments, mutations)
const SKIP_CACHE_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/payment\//,
  /\/api\/stripe\//,
  /\/api\/admin\//,
  /\/api\/orders\/create/,
  /\/api\/cron\//,
  /\/api\/revalidate/,
  /\/api\/dev\//,
  /\/api\/contact/,
  /\/api\/newsletter/,
  /\/api\/comments/,
  /\/api\/reviews/,
  /\/api\/upload/,
  /\/api\/log-404/,
  /\/api\/suggest-404/,
  /\/api\/stock-alerts/,
  /\/api\/push\//,
  /\/api\/customers/,
];

// API routes safe to cache (read-only, non-personalized data)
const CACHEABLE_API_PATTERNS = [
  /\/api\/products/,
  /\/api\/search/,
  /\/api\/blog/,
  /\/api\/posts/,
  /\/api\/coupons$/,
];

function shouldSkipCache(url) {
  return SKIP_CACHE_PATTERNS.some((pattern) => pattern.test(url));
}

function isCacheableApi(url) {
  return CACHEABLE_API_PATTERNS.some((pattern) => pattern.test(url));
}

async function cacheUrl(cache, url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to cache ${url} (${response.status})`);
  }
  await cache.put(url, response);
}

async function cacheCriticalResources(cache) {
  for (const url of CRITICAL_PRECACHE) {
    try {
      await cacheUrl(cache, url);
    } catch {
      if (url === '/offline.html') {
        await cache.put(
          '/offline.html',
          new Response(OFFLINE_FALLBACK_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      } else {
        throw new Error(`Critical precache failed for ${url}`);
      }
    }
  }
}

async function cacheOptionalResources(cache) {
  await Promise.allSettled(
    OPTIONAL_PRECACHE.map(async (url) => {
      try {
        await cacheUrl(cache, url);
      } catch {
        // Optional resource; ignore failures.
      }
    })
  );
}

// ─── Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHES.precache).then(async (cache) => {
      await cacheCriticalResources(cache);
      await cacheOptionalResources(cache);
    }),
  );
  // Don't call skipWaiting() here — let the client control via SKIP_WAITING message
});

// ─── Activate ───────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !ALL_CACHE_NAMES.includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // ── Navigation requests (HTML pages) ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, 8000)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHES.pages).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || caches.match('/offline.html')
          )
        )
    );
    return;
  }

  // ── API requests ──
  if (url.pathname.startsWith('/api/')) {
    if (shouldSkipCache(url.pathname)) return;
    if (isCacheableApi(url.pathname)) {
      networkFirst(event, CACHES.api, MAX_AGE.api);
      return;
    }
    return;
  }

  // ── Next.js static assets (_next/static/) ──
  if (url.pathname.startsWith('/_next/static/')) {
    // These are content-hashed, safe to cache forever
    cacheFirst(event, CACHES.static);
    return;
  }

  // ── Images ──
  if (
    request.destination === 'image' ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/favicon/')
  ) {
    cacheFirst(event, CACHES.images);
    return;
  }

  // ── Fonts ──
  if (request.destination === 'font') {
    cacheFirst(event, CACHES.static);
    return;
  }
});

// ─── Background Sync — replay queued requests ───────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-queue') {
    event.waitUntil(replayQueueFromIDB());
  }
});

async function replayQueueFromIDB() {
  const DB_NAME = 'maleq-sync';
  const STORE_NAME = 'pending-requests';

  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Read all items in a readonly transaction (completes before async work)
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Replay each item and delete successes in individual transactions
  for (const item of items) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      if (response.ok) {
        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
        deleteTx.objectStore(STORE_NAME).delete(item.id);
        await new Promise((resolve, reject) => {
          deleteTx.oncomplete = resolve;
          deleteTx.onerror = () => reject(deleteTx.error);
        });
      }
    } catch {
      // Still offline — SyncManager will retry later
      break;
    }
  }

  db.close();
}

// ─── Periodic cache cleanup (on message from client) ────────────────

self.addEventListener('message', (event) => {
  if (event.data === 'TRIM_CACHES') {
    trimCache(CACHES.pages, LIMITS.pages);
    trimCache(CACHES.images, LIMITS.images);
    trimCache(CACHES.api, LIMITS.api);
    trimCache(CACHES.static, LIMITS.static);
  }

  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Push Notifications ─────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Male Q', body: event.data.text() };
  }

  // Support both our custom payload.url and Declarative Web Push notification.navigate
  const notificationUrl = payload.url || payload.notification?.navigate || '/';

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon/android/android-launchericon-192-192.png',
    badge: payload.badge || '/favicon/favicon-32x32.png',
    tag: payload.tag || 'maleq-notification',
    data: { url: notificationUrl },
    renotify: !!payload.tag,
  };

  if (payload.image) {
    options.image = payload.image;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Male Q', options)
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        const message = {
          type: 'PUSH_RECEIVED',
          payload: {
            title: payload.title || 'Male Q',
            body: payload.body || '',
            url: notificationUrl,
            tag: payload.tag || 'maleq-notification',
          },
        };
        for (const client of clients) {
          client.postMessage(message);
        }
      })
      .catch((err) => {
        // showNotification failed (e.g., permission revoked) — log but don't crash
        console.error('Push notification display failed:', err);
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = event.notification.data?.url || '/';

  // Validate URL is same-origin to prevent open-redirect attacks
  let targetPath;
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    targetPath = parsed.origin === self.location.origin ? parsed.pathname : '/';
  } catch {
    targetPath = '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if one is open at the target URL
      for (const client of clients) {
        if (new URL(client.url).pathname === targetPath && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetPath);
    })
  );
});

// ─── Push Subscription Change ───────────────────────────────────────

self.addEventListener('pushsubscriptionchange', (event) => {
  // When the browser renews the push subscription, re-register with server
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options || { userVisibleOnly: true })
      .then((newSubscription) => {
        const sub = newSubscription.toJSON();
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys?.p256dh,
              auth: sub.keys?.auth,
            },
          }),
        });
      })
      .catch((err) => {
        console.error('Failed to re-subscribe after pushsubscriptionchange:', err);
      })
  );
});
