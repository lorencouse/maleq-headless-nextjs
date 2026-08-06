import { useAuthStore } from '@/lib/store/auth-store';

/**
 * `fetch` for authenticated same-origin API calls from client components.
 *
 * Identical to `fetch` (the httpOnly `maleq_session` cookie rides along
 * automatically) except that a 401 marks the session expired in the auth store.
 * That clears `isAuthenticated`, which trips AccountLayout's existing redirect
 * to /login — so an expired cookie surfaces as a re-auth prompt instead of a
 * signed-in UI where every request silently fails.
 *
 * The Response is returned untouched, so callers keep their own handling for
 * every other status. Client-only (relative URLs + store access).
 */
export async function fetchAuthed(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    useAuthStore.getState().sessionExpired();
  }
  return response;
}
