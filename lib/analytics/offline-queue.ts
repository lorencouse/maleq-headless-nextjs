/**
 * Offline Analytics Queue
 *
 * Queues GA events in localStorage when offline.
 * Flushes them to gtag() when connectivity returns.
 */

const QUEUE_KEY = 'maleq-analytics-queue';
const MAX_QUEUED = 100;

interface QueuedEvent {
  type: 'event' | 'config';
  args: unknown[];
  timestamp: number;
}

function getQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedEvent[]) {
  try {
    // Keep only the most recent events if over limit
    const trimmed = queue.slice(-MAX_QUEUED);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full — discard silently
  }
}

/**
 * Queue a gtag call for later replay.
 */
export function queueGtagCall(type: 'event' | 'config', ...args: unknown[]) {
  const queue = getQueue();
  queue.push({ type, args, timestamp: Date.now() });
  saveQueue(queue);
}

/**
 * Flush all queued events to gtag().
 * Returns the number of events flushed.
 */
export function flushQueue(): number {
  if (typeof window === 'undefined' || !window.gtag) return 0;

  const queue = getQueue();
  if (queue.length === 0) return 0;

  const failed: QueuedEvent[] = [];
  let flushed = 0;

  for (const entry of queue) {
    try {
      if (entry.type === 'event') {
        window.gtag('event', ...(entry.args as [string, ...unknown[]]));
      } else {
        window.gtag('config', ...(entry.args as [string, ...unknown[]]));
      }
      flushed++;
    } catch {
      failed.push(entry);
    }
  }

  // Keep only failed events in the queue
  if (failed.length > 0) {
    saveQueue(failed);
  } else {
    try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
  }

  return flushed;
}

/**
 * Get the number of pending queued events.
 */
export function getQueueSize(): number {
  return getQueue().length;
}
