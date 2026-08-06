'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';

/**
 * Revalidates the session against WordPress once per mount of an authenticated
 * area (see AccountLayout).
 *
 * The persisted auth store has no expiry, but the httpOnly `maleq_session`
 * cookie and the WP token behind it both last 24h. Without this check a
 * returning visitor gets a fully signed-in UI whose every API call 401s — the
 * failure mode looks like a broken page rather than an expired login.
 *
 * On a dead session this clears the store, which trips AccountLayout's redirect
 * to /login. On a live one it refreshes the cached profile — notably `role`,
 * which gates owner-only nav and is otherwise only ever written at login.
 *
 * Network and 5xx failures deliberately leave the session alone: being offline
 * or catching a bad gateway is not proof the login expired.
 */
/**
 * Timestamp of the last completed check, module-scoped so it survives the
 * remount that every account page causes (each renders its own AccountLayout).
 * Without it, clicking through the sidebar round-trips to WP on every nav.
 * A stale window is harmless: fetchAuthed still catches a 401 mid-session.
 */
let lastCheckedAt = 0;
const CHECK_INTERVAL_MS = 60_000;

export function useSessionGuard(): void {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const checked = useRef(false);

  useEffect(() => {
    // Wait for rehydration, or the check races the persisted state and fires
    // against a store that still looks signed out.
    if (!hasHydrated || !isAuthenticated || checked.current) return;
    checked.current = true;
    if (Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) return;

    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          sessionExpired();
          return;
        }
        if (!res.ok) return;
        // Only a definitive answer refreshes the window, so a 5xx retries on
        // the next mount rather than suppressing checks for a minute.
        lastCheckedAt = Date.now();
        const body = await res.json().catch(() => null);
        if (!cancelled && body?.user) setUser(body.user);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [hasHydrated, isAuthenticated, setUser, sessionExpired]);
}
