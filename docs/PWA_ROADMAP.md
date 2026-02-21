# PWA Roadmap — Male Q

## Phase 1: Basic PWA (Current) ✅

- [x] Web app manifest with icons, start_url, display: standalone
- [x] Service worker with offline fallback page
- [x] Cache-first strategy for static assets (images, fonts, CSS)
- [x] CSP updated with `worker-src 'self'`
- [x] Service worker registration in app layout

## Phase 2: Enhanced Caching

- [ ] **Runtime caching strategies** — Cache product pages, category pages, and blog posts on first visit using stale-while-revalidate
- [ ] **API response caching** — Cache product data and search results for offline browsing
- [ ] **Precache critical routes** — Home, shop, and top category pages precached at install time
- [ ] **Cache versioning** — Automated cache busting on deployments (tie cache version to build ID)
- [ ] **Cache size limits** — Set max entries/age for runtime caches to prevent unbounded storage growth

## Phase 3: Offline Product Browsing

- [ ] **Offline product catalog** — Store recently viewed products in IndexedDB for full offline access
- [ ] **Offline search** — Enable MiniSearch to work against locally cached product data
- [ ] **Offline category browsing** — Cache category listings so users can browse while offline
- [ ] **Sync indicator** — Show a banner/toast when user is offline with cached content

## Phase 4: Push Notifications

- [ ] **Push notification opt-in** — Prompt users to subscribe (post-purchase or after N visits)
- [ ] **Order status updates** — Notify when order ships, out for delivery, delivered
- [ ] **Back-in-stock alerts** — Notify when a wishlisted/out-of-stock product is available
- [ ] **Sale/promotion alerts** — Notify subscribed users of new sales
- [ ] **Server-side push** — WordPress mu-plugin to send push notifications via Web Push API
- [ ] **Notification preferences** — Let users control which notification types they receive

## Phase 5: Background Sync & Offline Cart

- [ ] **Offline cart** — Allow adding items to cart while offline, sync when back online
- [ ] **Background sync** — Queue form submissions (contact, reviews) and sync when connectivity returns
- [ ] **Wishlist sync** — Offline wishlist management with background sync

## Phase 6: Install Experience & App-Like Features

- [ ] **Custom install prompt** — Show an in-app banner encouraging PWA installation (defer the native prompt)
- [ ] **App shortcuts** — Add manifest shortcuts for Shop, Cart, Account, Search
- [ ] **Share target** — Register as a share target so users can share products from other apps
- [ ] **Badge API** — Show cart item count as app badge on the home screen icon
- [ ] **Periodic background sync** — Check for price drops or new arrivals in the background

## Phase 7: Performance & Analytics

- [ ] **Lighthouse CI** — Automated PWA audit in CI pipeline, fail on regression
- [ ] **Install analytics** — Track PWA install rates, standalone usage vs browser
- [ ] **Offline usage analytics** — Queue analytics events offline, flush when connected
- [ ] **Web Vitals from standalone** — Compare Core Web Vitals between browser and installed PWA

## Notes

- Service worker is at `/public/sw.js` (manually maintained, no build tool)
- If caching needs grow significantly, consider migrating to [Serwist](https://serwist.pages.dev/) (Workbox successor for Next.js) for precache manifests and routing
- Push notifications require a VAPID key pair and a server-side push service — plan for a `push-service` mu-plugin or standalone microservice
- Test installability with Chrome DevTools > Application > Manifest and Lighthouse PWA audit
