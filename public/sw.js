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
    fetch(event.request)
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

// ─── Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHES.precache).then(async (cache) => {
      // Critical resources must succeed
      await cache.addAll(CRITICAL_PRECACHE);
      // Optional resources can fail without blocking install
      await Promise.allSettled(OPTIONAL_PRECACHE.map((url) => cache.add(url)));
    })
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
      fetch(request)
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
    icon: payload.icon || '/favicon/android/android-launchericon-192-192.png',
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
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        const message = {
          type: 'PUSH_RECEIVED',
          payload: {
            title: payload.title || 'Male Q',
            body: payload.body || '',
            url: payload.url || '/',
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
