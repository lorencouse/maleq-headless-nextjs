/**
 * Stale app-shell recovery.
 *
 * After a deploy, Next.js ships new content-hashed JS chunks and a new buildId;
 * the previous build's chunks/data are deleted from the server. A returning
 * visitor whose browser HTTP cache, back/forward (bfcache), or service worker
 * is holding the OLD HTML shell will request those now-missing chunks the moment
 * they interact, and the dynamic import fails with a `ChunkLoadError` — surfacing
 * as "Application error: a client-side exception has occurred". Incognito always
 * gets the current build, which is why it never reproduces.
 *
 * The fix is vector-agnostic: when we detect a chunk-load failure, drop the
 * service-worker caches that can hold a stale shell, then do a ONE-TIME hard
 * reload (guarded against loops) so the browser re-fetches the live build.
 */

const RELOAD_GUARD_KEY = 'maleq:chunk-reload-ts';
// If we already force-reloaded within this window, don't do it again — a second
// chunk error right after a reload means reloading won't help (avoid a loop).
const RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|import\(\) failed|Importing a module script failed/i;

/** True when an error looks like a missing/failed JS or CSS chunk load. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') return CHUNK_ERROR_RE.test(error);
  const err = error as { name?: unknown; message?: unknown };
  if (err.name === 'ChunkLoadError') return true;
  const msg = typeof err.message === 'string' ? err.message : String(error ?? '');
  return CHUNK_ERROR_RE.test(msg);
}

/** True when a resource-load `error` event targets a Next.js static chunk. */
export function isNextChunkResourceError(event: Event): boolean {
  const target = event.target as (HTMLScriptElement | HTMLLinkElement) | null;
  if (!target) return false;
  const url =
    (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
  return url.includes('/_next/static/');
}

/**
 * Best-effort purge of the SW caches that can serve a stale shell (page HTML +
 * hashed chunks), then a single guarded hard reload. Returns true if a reload
 * was triggered, false if suppressed by the cooldown guard.
 */
export function recoverFromStaleChunks(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0');
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked (private mode/quota) — proceed with one reload.
  }

  const reload = () => window.location.reload();

  // Drop the SW page/static caches so the reload can't be handed back the same
  // stale HTML that points at the deleted chunks. Don't let cache work hang the
  // recovery — reload regardless after a short beat.
  if (typeof caches !== 'undefined') {
    const purge = caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('maleq-pages') || k.startsWith('maleq-static'))
            .map((k) => caches.delete(k)),
        ),
      )
      .catch(() => {});
    Promise.race([purge, new Promise((r) => setTimeout(r, 1500))]).finally(reload);
  } else {
    reload();
  }
  return true;
}
