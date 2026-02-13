# Security Audit Report - Male Q Headless

**Date:** February 12, 2026
**Scope:** Full codebase and configuration review (Next.js frontend, WordPress mu-plugins, API routes, dependencies)
**Supersedes:** January 19, 2026 audit

---

## Executive Summary

The application has good foundational security practices (rate limiting, input validation, security headers, Zod schemas), but **critical authentication and authorization flaws** must be addressed before production use. The most severe issues are:

1. **Forgeable authentication tokens** - tokens can be crafted without cryptographic verification
2. **Broken access control** - users can access/modify other users' data (IDOR)
3. **No HTML sanitization** - WordPress content rendered via `dangerouslySetInnerHTML` without DOMPurify
4. **Timing-unsafe secret comparisons** - token/key comparisons use `===` instead of constant-time functions

**Total Findings:** 7 Critical, 10 High, 12 Medium, 8 Low

---

## CRITICAL ISSUES

### C1. Forgeable Authentication Tokens (Account Takeover)

**File:** `app/api/auth/me/route.ts:17-29`

The `/api/auth/me` endpoint decodes tokens as simple Base64 without any cryptographic signature:

```typescript
const decoded = Buffer.from(token, 'base64').toString('utf-8');
const [customerIdStr] = decoded.split(':');
const customerId = parseInt(customerIdStr, 10);
```

**Attack:** An attacker can create `base64("999:1234567890:anything")` and impersonate customer ID 999. No HMAC, no JWT signature, no server-side validation against the WordPress-stored token hash.

**Fix:** Replace with signed JWT tokens (HS256/RS256) or validate the token against the WordPress `maleq_auth_token` hash on every request by calling the WordPress backend.

---

### C2. Insecure Direct Object Reference (IDOR) on Customer Endpoints

**Files:** `app/api/customers/[id]/route.ts:5-46`, `app/api/customers/[id]/delete/route.ts`

No verification that the authenticated user owns the requested customer ID:

```typescript
// GET /api/customers/[id] - Any authenticated user can read ANY customer's data
const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/customer/${customerId}`, {
  headers: { ...(authHeader ? { Authorization: authHeader } : {}) },
});
```

**Impact:** Read/update/delete any customer's personal data (name, email, addresses).

**Fix:** Extract authenticated user ID from token, verify it matches the `[id]` parameter. Return 403 if mismatched.

---

### C3. WordPress Auth Endpoints Allow Unauthenticated Access to Sensitive Operations

**File:** `wordpress/mu-plugins/maleq-auth-endpoints.php:16-71`

All 8 REST endpoints use `'permission_callback' => '__return_true'`:
- `/maleq/v1/upload-avatar` (POST) - upload avatar for any user
- `/maleq/v1/delete-account` (POST) - delete any account
- `/maleq/v1/customer/{id}` (GET/PUT) - read/write any customer data

While callbacks like `maleq_upload_avatar()`, `maleq_delete_account()`, `maleq_get_customer()`, and `maleq_update_customer()` call `maleq_authenticate_request()` internally, WordPress does not enforce authentication at the routing layer. Bots and scanners can probe these endpoints without restriction.

**Fix:** Replace `__return_true` with a proper `permission_callback` that checks the Bearer token for endpoints that require auth. Keep `__return_true` only for login/register/forgot-password.

---

### C4. IDOR in maleq_authenticate_request() - User ID from Request Body

**File:** `wordpress/mu-plugins/maleq-auth-endpoints.php:312-347`

```php
if (!$user_id) {
    $user_id = absint($request->get_param('user_id'));
}
```

The authentication function accepts `user_id` from the request body, then validates the provided token against that user's stored hash. This means: if an attacker has User A's valid token and sends `user_id=A` in a request to `/customer/B`, the token validates for User A but the endpoint operates on User B (via the URL parameter).

**Fix:** The authenticated user_id from token validation must be the ONLY user_id used. Never accept user_id from the request body for authorization decisions.

---

### C5. No HTML Sanitization on WordPress Content (Stored XSS)

**Files:** `app/guides/[slug]/page.tsx:254`, `components/shop/BrandHero.tsx:56`, `app/guides/category/[slug]/page.tsx:112`, `app/guides/tag/[slug]/page.tsx:148`

```tsx
dangerouslySetInnerHTML={{ __html: processWordPressContent(post.content) }}
```

`processWordPressContent()` only rewrites URLs and removes shortcodes - it does **NOT** sanitize HTML. `isomorphic-dompurify` is referenced in CLAUDE.md but is **not installed** in package.json and **never imported** anywhere.

Blog comments are also rendered unsanitized. If WordPress moderation is bypassed or a contributor injects malicious HTML, it executes in all visitors' browsers.

**Fix:**
```bash
bun add isomorphic-dompurify @types/dompurify
```
```typescript
import DOMPurify from 'isomorphic-dompurify';
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(processWordPressContent(content)) }}
```

---

### C6. Token Stored in localStorage (Vulnerable to XSS Theft)

**File:** `lib/store/auth-store.ts:86-92`

Auth tokens persisted to localStorage via Zustand persist middleware:

```typescript
partialize: (state) => ({
  user: state.user,
  token: state.token,  // Plaintext in localStorage
  isAuthenticated: state.isAuthenticated,
}),
```

Combined with C5 (XSS vectors), this means a successful XSS attack can steal auth tokens from `localStorage.getItem('auth-storage')`.

**Fix:** Store tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies instead. This makes them inaccessible to JavaScript.

---

### C7. Timing Attack on Token/Secret Comparisons

**File:** `wordpress/mu-plugins/maleq-auth-endpoints.php:368`

```php
return wp_hash($token) === $stored_hash;
```

Uses `===` (regular string comparison) instead of `hash_equals()`, making it vulnerable to timing attacks that can leak the hash byte-by-byte.

**Also at:** `lib/api/admin-auth.ts:20` (ADMIN_API_KEY comparison), `wordpress/mu-plugins/maleq-stock-sync.php:26`

**Fix:** Use `hash_equals()` for all secret comparisons in PHP. Use `crypto.timingSafeEqual()` in Node.js.

---

## HIGH SEVERITY ISSUES

### H1. No Rate Limiting on WordPress Auth Endpoints

**File:** `wordpress/mu-plugins/maleq-auth-endpoints.php:77-134`

The login endpoint (`/maleq/v1/validate-password`) has no rate limiting and no account lockout. The Next.js middleware rate limits `/api/auth/login` at 10 req/min, but direct calls to the WordPress REST API bypass this entirely.

**Fix:** Implement rate limiting at the WordPress level (transient-based counter per IP/user). Lock accounts after 5 failed attempts for 15 minutes.

---

### H2. User Enumeration via Distinct Error Messages

**File:** `wordpress/mu-plugins/maleq-auth-endpoints.php:100-114`

```php
return new WP_Error('invalid_login', 'No account found with this email or username', ...);
// vs.
return new WP_Error('incorrect_password', 'Incorrect password', ...);
```

**Fix:** Use a single generic message: "Invalid email/username or password."

---

### H3. In-Memory Rate Limiter Ineffective in Production

**File:** `lib/api/rate-limit.ts`

The rate limiter uses a `Map()` in memory. On Vercel serverless, each cold start gets a fresh Map - rate limits reset constantly and don't share across instances.

**Fix:** Use Upstash Redis rate limiting (`@upstash/ratelimit`) or Vercel's built-in rate limiting.

---

### H4. CSP Allows `unsafe-inline` for Scripts

**File:** `next.config.ts:212-215`

```
script-src 'self' 'unsafe-inline' https://js.stripe.com ...
style-src 'self' 'unsafe-inline'
```

`unsafe-inline` negates most of CSP's XSS protection. Combined with the XSS vectors in C5, inline scripts can execute freely.

**Fix:** Remove `unsafe-inline` from `script-src`. Use nonce-based CSP (`'nonce-<random>'`) for necessary inline scripts (GA, Stripe). `unsafe-inline` in `style-src` is harder to remove but less risky.

---

### H5. Overly Permissive img-src CSP

**File:** `next.config.ts:216`

```
img-src 'self' data: blob: https: http:
```

Allows loading images from ANY domain over HTTP or HTTPS.

**Fix:** Restrict to specific domains:
```
img-src 'self' data: blob: https://www.maleq.com https://wp.maleq.com https://staging.maleq.com https://images.williams-trading.com
```

---

### H6. Revalidation Secret Accepted via Query Parameter

**File:** `app/api/revalidate/route.ts:8-11`

```typescript
const querySecret = request.nextUrl.searchParams.get('secret');
const secret = headerSecret || querySecret;
```

Query parameters are logged in server access logs, browser history, CDN caches, and Referer headers.

**Fix:** Accept secrets only via `Authorization` or custom headers. Remove query parameter support.

---

### H7. No CSRF Protection on State-Changing Endpoints

No CSRF tokens on login, register, order creation, customer update, or account deletion endpoints.

**Fix:** Implement CSRF tokens or validate `Origin`/`Referer` headers on all POST/PUT/DELETE endpoints.

---

### H8. Comment Author Emails Exposed in GraphQL

**File:** `lib/queries/posts.ts:82-88, 227-233`

```graphql
comments { nodes { author { node { name, email } } } }
```

Email addresses of all blog commenters are fetched and potentially exposed to the client.

**Fix:** Remove `email` from the comment author GraphQL query.

---

### H9. No Logout Token Invalidation

Logout only clears client-side state (`auth-store.ts:70-76`). No `/api/auth/logout` endpoint deletes the `maleq_auth_token` user meta in WordPress. Stolen tokens remain valid until the 24-hour expiry.

**Fix:** Add a logout endpoint that calls WordPress to delete the user's `maleq_auth_token` meta.

---

### H10. Inconsistent Password Requirements

**Files:** `lib/validations/auth.ts:22-25` (registration: 12 chars), `app/account/details/page.tsx:165` (password change: 8 chars)

**Fix:** Enforce consistent 12-character minimum everywhere. Add complexity requirements (uppercase, lowercase, number).

---

## MEDIUM SEVERITY ISSUES

### M1. Hardcoded Staging URL
`app/api/admin/sync/categories/cleanup/route.ts:40` - Uses `https://staging.maleq.com` instead of env var.

### M2. Weak Email Validation
`lib/api/validation.ts:9` - Regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` is overly permissive. Use Zod's `.email()`.

### M3. Missing Input Length Limits
`app/api/orders/create/route.ts` - SKU and product name fields in Zod schema have no max length.
`app/api/coupons/validate/route.ts` - Coupon code and productIds array have no length limits.

### M4. File Upload MIME Type Spoofing
`app/api/upload/avatar/route.ts` - Checks `file.type` (client-controlled) but doesn't validate actual file content via magic bytes. Use `file-type` package.

### M5. Stripe Webhook Silently Swallows Errors
`app/api/stripe/webhook/route.ts:77-82` - Returns 200 even on handler failure. Failed webhook events are never retried by Stripe.

### M6. Database Error Messages Exposed
`wordpress/mu-plugins/maleq-stock-sync.php:81-86` - Raw `$wpdb->last_error` returned in API response.

### M7. No Rate Limiting on Search/Blog Endpoints
`/api/search` and `/api/blog/search` are not in the `RATE_LIMITED_ROUTES` config. Could be abused for DoS or scraping.

### M8. Missing `hash_equals()` in Stock Sync Admin Auth
`wordpress/mu-plugins/maleq-stock-sync.php:26` - String comparison for API key.

### M9. Order Creation Doesn't Validate Customer Ownership
`app/api/orders/create/route.ts` - Optional `customerId` field not verified against authenticated user.

### M10. Source Maps in Build Output
100+ `.js.map` files in `.next/` directory. Verify production builds have source maps disabled.

### M11. processWordPressContent() Misleading Name
`lib/utils/content.ts` - Function name suggests content processing/sanitization but only rewrites URLs. Rename to `rewriteWordPressUrls()` to avoid false sense of security.

### M12. Sensitive Console Logging
Multiple API routes log full error objects with `console.error()`. In development mode, error messages are returned to clients.

---

## LOW SEVERITY ISSUES

### L1. Missing Security Headers
- `X-Permitted-Cross-Domain-Policies: none` not set
- `Permissions-Policy` missing `usb`, `magnetometer`, `gyroscope`, `accelerometer`

### L2. Hardcoded Fallback URLs
`wordpress/mu-plugins/maleq-auth-endpoints.php:220` - Fallback `https://www.maleq.com` for password reset emails.

### L3. No SRI on External Scripts
Google Analytics script loaded without Subresource Integrity hash.

### L4. target="_blank" Links
All instances properly use `rel="noopener noreferrer"`. No issue found.

### L5. Missing ABSPATH Check
`wordpress/mu-plugins/maleq-email-customizer.php` - No `if (!defined('ABSPATH')) exit;` guard.

### L6. GraphQL Batching/Depth Not Verified
WPGraphQL may accept batched or deeply nested queries. Verify limits are configured.

### L7. Credentials in .env.local Comments
`.env.local` has commented-out live Stripe keys and staging DB credentials. While .gitignore excludes this file, the credentials should be removed from the file entirely and rotated.

### L8. Developer Username in Code
`scripts/lib/db.ts:13` exposes `/Users/lorencouse/` in hardcoded MySQL socket path.

---

## Prioritized Remediation Plan

### Immediate (This Week)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | **C1** - Sign tokens cryptographically (JWT) | Medium | Prevents account takeover |
| 2 | **C2** - Add ownership checks on customer endpoints | Low | Prevents IDOR data theft |
| 3 | **C4** - Never accept user_id from request body for auth | Low | Prevents auth bypass |
| 4 | **C7** - Use `hash_equals()` / `timingSafeEqual()` everywhere | Low | Prevents timing attacks |
| 5 | **C5** - Install DOMPurify, sanitize all HTML rendering | Low | Prevents stored XSS |
| 6 | **H2** - Generic login error messages | Low | Prevents user enumeration |
| 7 | **L7** - Remove commented credentials, rotate keys | Low | Prevents credential exposure |

### Short-Term (This Month)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 8 | **C6** - Move tokens to httpOnly cookies | Medium | XSS can't steal tokens |
| 9 | **C3** - Proper permission_callbacks in WP | Medium | Defense in depth |
| 10 | **H1** - WordPress-level rate limiting | Medium | Prevents brute force |
| 11 | **H3** - Redis-based rate limiting (Upstash) | Medium | Production rate limiting |
| 12 | **H9** - Server-side logout/token invalidation | Low | Reduces token theft window |
| 13 | **H8** - Remove emails from comment queries | Low | Privacy compliance |
| 14 | **H10** - Consistent password requirements | Low | Stronger passwords |
| 15 | **M3-M4** - Input validation hardening | Low | Defense in depth |

### Medium-Term (This Quarter)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 16 | **H4** - Nonce-based CSP (remove unsafe-inline) | High | Full XSS prevention |
| 17 | **H5** - Restrict img-src domains | Low | Reduces attack surface |
| 18 | **H6-H7** - CSRF protection, header-only secrets | Medium | Prevents CSRF |
| 19 | **M5** - Stripe webhook error handling | Low | Payment reliability |
| 20 | **M7** - Rate limit search endpoints | Low | DoS prevention |
| 21 | **L1** - Additional security headers | Low | Defense in depth |

---

## Server Hardening Recommendations

### WordPress Backend
1. **Disable XML-RPC** - `add_filter('xmlrpc_enabled', '__return_false');`
2. **Disable REST API user enumeration** - Block `/wp-json/wp/v2/users` for unauthenticated requests
3. **Hide WordPress version** - `remove_action('wp_head', 'wp_generator');`
4. **Disable file editing** - `define('DISALLOW_FILE_EDIT', true);` in wp-config.php
5. **Limit login attempts** - Install Limit Login Attempts Reloaded or implement in mu-plugin
6. **Force HTTPS** - `define('FORCE_SSL_ADMIN', true);`
7. **Disable directory listing** - Add `Options -Indexes` to .htaccess
8. **Set proper file permissions** - wp-config.php should be 640, wp-content 755

### Vercel/Next.js Production
1. **Enable Vercel WAF** if available on your plan
2. **Use Vercel Environment Variables** for all secrets (not .env files)
3. **Enable DDoS protection** via Vercel or Cloudflare
4. **Disable source maps** in production: `productionBrowserSourceMaps: false` in next.config.ts
5. **Set up security monitoring** - Sentry for error tracking, alerts on auth failures

### Database
1. **Use a dedicated DB user** with minimal privileges (not root)
2. **Enable MySQL TLS** for remote connections
3. **Regular backups** with encryption at rest
4. **Audit logging** on sensitive tables (users, orders, postmeta)

### General
1. **Enable 2FA** for WordPress admin accounts
2. **Set up WAF rules** for common attack patterns (SQLi, XSS, path traversal)
3. **Implement security logging** - log all auth events, admin actions, and failed requests
4. **Regular dependency audits** - `bun audit` on a schedule
5. **HSTS preload** - Submit domain to hstspreload.org (header is already set)
6. **Implement CSP reporting** - Add `report-uri` directive to collect violation reports

---

## What's Working Well

- Rate limiting infrastructure exists (needs Redis for production)
- Security headers configured (CSP, HSTS, X-Frame-Options, Permissions-Policy)
- Input validation with Zod on most API routes
- `.env.local` properly in `.gitignore`
- Admin endpoints protected with `ADMIN_API_KEY`
- Error responses sanitized in production mode (`handleApiError()`)
- TypeScript strict mode enabled
- No `eval()`, `new Function()`, or other code injection vectors
- All `target="_blank"` links use `rel="noopener noreferrer"`
- Order confirmation validates order key before displaying data
- WPGraphQL queries are parameterized (no string interpolation)
- Stripe webhook signature verification is implemented
- Stripe Elements used for card data (PCI compliant - card data never touches server)
- Cart/checkout/account pages have `robots: { index: false }`

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-12 | Comprehensive re-audit with 37 findings across 6 security domains |
| 1.0 | 2026-01-19 | Initial audit |
