# PWA Roadmap — Male Q

## Phase 1: Basic PWA ✅

- [x] Web app manifest with icons, start_url, display: standalone
- [x] Service worker with offline fallback page
- [x] Cache-first strategy for static assets (images, fonts, CSS)
- [x] CSP updated with `worker-src 'self'`
- [x] Service worker registration in app layout

## Phase 2: Enhanced Caching ✅

- [x] **Runtime caching strategies** — Network-first for navigations (cache visited pages), stale-while-revalidate for Next.js data, cache-first for static assets
- [x] **API response caching** — Network-first caching for `/api/products`, `/api/search`, `/api/blog` (skips auth/payment/admin routes)
- [x] **Precache critical routes** — Home and shop pages precached at install time
- [x] **Cache versioning** — Versioned cache names (`maleq-{type}-v2`), old caches cleaned on activate
- [x] **Cache size limits** — Max entries per cache (pages: 50, images: 200, API: 100, static: 100) with periodic trimming
- [x] **Network timeouts** — 8s timeout for navigation, 5s for API requests with cache fallback (`fetchWithTimeout` in SW)

## Phase 3: Offline Product Browsing ✅

- [x] **Offline product catalog** — Store viewed products in IndexedDB (up to 100) via `lib/pwa/offline-products.ts`
- [x] **Offline search** — MiniSearch index built from IndexedDB products, fallback in `useProductSearch` and `SearchAutocomplete` (`lib/pwa/offline-search.ts`)
- [x] **Offline category browsing** — `getOfflineCategories()` and `getOfflineProductsByCategory()` derive categories from cached products
- [x] **Sync indicator** — Toast notification when user goes offline/online via `OfflineIndicator`

## Phase 4: Push Notifications ✅

- [x] **Push notification opt-in** — Prompt users to subscribe (post-purchase or after N visits)
- [x] **Order status updates** — Notify when order ships, out for delivery, delivered
- [x] **Back-in-stock alerts** — Notify when a wishlisted/out-of-stock product is available
- [x] **Sale/promotion alerts** — Notify subscribed users of new sales
- [x] **Server-side push** — WordPress mu-plugin to send push notifications via Web Push API
- [x] **Notification preferences** — Let users control which notification types they receive

## Phase 5: Background Sync & Offline Cart ✅

- [x] **Offline cart** — Cart already works offline (Zustand + localStorage). Added `CartStockRevalidation` to check stock when back online.
- [x] **Background sync** — `submitWithSync()` queues POST requests in IndexedDB when offline; SW `sync` event + client-side `online` listener replay the queue (`lib/pwa/background-sync.ts`)
- [x] **Wishlist sync** — Wishlist is localStorage-based (Zustand), works offline natively. No server-side sync needed.

## Phase 6: Install Experience & App-Like Features ✅

- [x] **Custom install prompt** — `InstallPrompt` component listens for `beforeinstallprompt`, shows banner after 2 visits
- [x] **App shortcuts** — Manifest shortcuts for Shop, Account, Search
- [x] **Share target** — Manifest `share_target` + `/share` handler page routes shared URLs/text to shop search
- [x] **Badge API** — `AppBadge` component syncs cart item count to home screen icon via `navigator.setAppBadge()`
- [x] **iOS polish** — `appleWebApp` metadata (capable, black-translucent status bar), `viewport-fit: cover` for notched iPhones
- [ ] **Periodic background sync** — Check for price drops or new arrivals in the background

## Phase 7: Performance & Analytics ✅

- [x] **Lighthouse CI** — GitHub Actions workflow runs Lighthouse on PRs, asserts PWA score >= 90 (`lighthouserc.js`, `.github/workflows/lighthouse.yml`)
- [x] **Install analytics** — GA events for prompt shown/clicked/accepted/dismissed, `appinstalled`, standalone vs browser mode (`PwaAnalytics`)
- [x] **Offline usage analytics** — All gtag calls queue in localStorage when offline, flush on reconnect (`lib/analytics/offline-queue.ts`)
- [x] **Web Vitals from standalone** — CLS, INP, LCP, FCP, TTFB reported to GA with `pwa_display_mode` dimension (`components/analytics/WebVitals.tsx`)

## Notes

- Service worker is at `/public/sw.js` (manually maintained, no build tool)
- If caching needs grow significantly, consider migrating to [Serwist](https://serwist.pages.dev/) (Workbox successor for Next.js) for precache manifests and routing
- Push notifications require a VAPID key pair and a server-side push service — plan for a `push-service` mu-plugin or standalone microservice
- Test installability with Chrome DevTools > Application > Manifest and Lighthouse PWA audit
- Background sync requires `SyncManager` API (Chrome/Edge only); client-side `online` listener is the fallback for Safari/Firefox
