// ─── Cache Configuration ────────────────────────────────────────────
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'maleq';

const CACHES = {
  precache: `${CACHE_PREFIX}-precache-${CACHE_VERSION}`,
  pages: `${CACHE_PREFIX}-pages-${CACHE_VERSION}`,
  static: `${CACHE_PREFIX}-static-${CACHE_VERSION}`,
  images: `${CACHE_PREFIX}-images-${CACHE_VERSION}`,
  api: `${CACHE_PREFIX}-api-${CACHE_VERSION}`,
};

const ALL_CACHE_NAMES = Object.values(CACHES);

// Pages to precache at install time
const PRECACHE_URLS = [
  '/offline.html',
  '/',
  '/shop',
];

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

// Stale-while-revalidate: return cached immediately, update in background
function staleWhileRevalidate(event, cacheName) {
  event.respondWith(
    caches.open(cacheName).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        });

        return cached || fetched;
      })
    )
  );
}

// Network-first: try network, fall back to cache
function networkFirst(event, cacheName) {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
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
];

// API routes safe to cache (read-only data)
const CACHEABLE_API_PATTERNS = [
  /\/api\/products/,
  /\/api\/search/,
  /\/api\/blog/,
  /\/api\/posts/,
  /\/api\/coupons$/,  // coupon list (not validate)
  /\/api\/customers/,
];

function shouldSkipCache(url) {
  return SKIP_CACHE_PATTERNS.some((pattern) => pattern.test(url));
}

function isCacheableApi(url) {
  return CACHEABLE_API_PATTERNS.some((pattern) => pattern.test(url));
}

// ─── Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHES.precache).then((cache) =>
      // Use individual add() calls so one failure doesn't block install
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
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
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHES.pages).then((cache) => {
              cache.put(request, clone);
              trimCache(CACHES.pages, LIMITS.pages);
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
      networkFirst(event, CACHES.api);
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

  // ── Next.js data requests (_next/data/) ──
  if (url.pathname.startsWith('/_next/data/')) {
    staleWhileRevalidate(event, CACHES.pages);
    return;
  }
});

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

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon/android-chrome-192x192.png',
    badge: payload.badge || '/favicon/favicon-32x32.png',
    tag: payload.tag || 'maleq-notification',
    data: { url: payload.url || '/' },
    renotify: !!payload.tag,
  };

  if (payload.image) {
    options.image = payload.image;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Male Q', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if one is open at the target URL
      for (const client of clients) {
        if (new URL(client.url).pathname === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(url);
    })
  );
});
