import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Authentication State Management
 *
 * Manages user authentication state. The session TOKEN is NOT stored here or in
 * localStorage — it lives in an httpOnly `maleq_session` cookie that the auth
 * routes set and the browser sends automatically with same-origin requests, so
 * an XSS can't read it. Only the non-sensitive `user` profile + `isAuthenticated`
 * flag are persisted (for instant UI gating on reload); the cookie is the real
 * source of truth, and any API call with an expired cookie returns 401.
 *
 * The `token` field is retained as always-null for backward compatibility with
 * components that still read it (their `Authorization` headers are ignored
 * server-side in favour of the cookie — see lib/api/auth-token.ts).
 */

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl?: string;
  /** WP role ('administrator' for the site owner) — gates owner-only nav/UI.
   * Server routes never trust this; they re-validate against WordPress. */
  role?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  hasHydrated: boolean;
  /** True when the session ended because the cookie/WP token expired rather
   * than the user signing out — lets /login explain why they're back there.
   * Deliberately not persisted; it only needs to survive the redirect. */
  wasSessionExpired: boolean;
}

interface AuthActions {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  login: (user: User) => void;
  logout: () => void;
  sessionExpired: () => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  hasHydrated: false,
  wasSessionExpired: false,
};

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      ...initialState,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
        }),

      setToken: (token) => set({ token }),

      // `token` param is accepted but ignored — the session token now lives in
      // the httpOnly cookie set by the auth route, not in JS state.
      login: (user) =>
        set({
          user,
          token: null,
          isAuthenticated: true,
          error: null,
          wasSessionExpired: false,
        }),

      logout: () => {
        // Fire-and-forget server-side invalidation. The cookie is sent
        // automatically (same-origin), so no Authorization header is needed;
        // the route clears the cookie + invalidates the WP token.
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
          wasSessionExpired: false,
        });
      },

      // The session died server-side: the httpOnly cookie or the WP token
      // behind it expired (both 24h) while the persisted store — which has no
      // expiry — still said "signed in". Unlike logout() this makes no
      // /api/auth/logout call, because the token is already invalid. Clearing
      // `isAuthenticated` is what trips AccountLayout's redirect to /login.
      sessionExpired: () =>
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
          wasSessionExpired: true,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      clearError: () => set({ error: null }),

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'auth-storage',
      // NOTE: `token` is deliberately NOT persisted — it lives in the httpOnly
      // cookie only. Persisting it would re-expose it to XSS via localStorage.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Selectors
export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthToken = () => useAuthStore((state) => state.token);
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);
export const useAuthError = () => useAuthStore((state) => state.error);
