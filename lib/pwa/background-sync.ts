/**
 * Background Sync Queue
 *
 * Queues POST requests (contact forms, reviews) in IndexedDB when offline.
 * Replays them when connectivity returns via the SW sync event or
 * a client-side online listener fallback.
 */

const DB_NAME = 'maleq-sync';
const DB_VERSION = 1;
const STORE_NAME = 'pending-requests';

export interface QueuedRequest {
  id?: number; // Auto-increment key
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue a request for later replay.
 */
export async function queueRequest(req: Omit<QueuedRequest, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({ ...req, createdAt: Date.now() });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  // Request a Background Sync if supported
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } })
      .sync.register('replay-queue');
  }
}

/**
 * Get all pending requests.
 */
export async function getPendingRequests(): Promise<QueuedRequest[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Remove a request from the queue after successful replay.
 */
export async function removeRequest(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const REPLAY_LOCK_KEY = 'maleq-sync-replay-lock';
const LOCK_TTL_MS = 30_000; // 30s max lock duration

/**
 * Replay all pending requests. Called when back online.
 * Uses a localStorage mutex to prevent duplicate replays across tabs.
 * Returns the number of successfully replayed requests.
 */
export async function replayQueue(): Promise<number> {
  // Acquire lock — prevent concurrent replay across tabs
  try {
    const existing = localStorage.getItem(REPLAY_LOCK_KEY);
    if (existing && Date.now() - Number(existing) < LOCK_TTL_MS) {
      return 0; // Another tab is replaying
    }
    localStorage.setItem(REPLAY_LOCK_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — proceed without lock
  }

  try {
    const pending = await getPendingRequests();
    let replayed = 0;

    for (const req of pending) {
      try {
        const response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });

        if (response.ok && req.id !== undefined) {
          await removeRequest(req.id);
          replayed++;
        }
      } catch {
        // Still offline or server error — leave in queue for next attempt
        break;
      }
    }

    return replayed;
  } finally {
    try {
      localStorage.removeItem(REPLAY_LOCK_KEY);
    } catch {
      // Ignore
    }
  }
}

/**
 * Submit a form with offline fallback.
 * If online, posts directly. If offline, queues for background sync.
 * Returns { queued: true } when queued, or the response data when sent.
 */
export async function submitWithSync<T = unknown>(
  url: string,
  data: unknown,
): Promise<{ queued: boolean; data?: T }> {
  const body = JSON.stringify(data);
  const headers = { 'Content-Type': 'application/json' };

  if (navigator.onLine) {
    try {
      const response = await fetch(url, { method: 'POST', headers, body });
      if (response.ok) {
        const responseData = await response.json();
        return { queued: false, data: responseData as T };
      }
      // Don't queue client errors (4xx) — they won't succeed on retry
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error ${response.status}`);
      }
      // Server error (5xx) — fall through to queue for retry
    } catch (err) {
      // Re-throw client errors so the caller can handle them
      if (err instanceof Error && err.message.startsWith('Client error')) {
        throw err;
      }
      // Network error — fall through to queue
    }
  }

  await queueRequest({ url, method: 'POST', headers, body });
  return { queued: true };
}
