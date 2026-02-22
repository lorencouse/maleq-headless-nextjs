'use client';

import { useEffect } from 'react';
import { replayQueue, getPendingRequests } from '@/lib/pwa/background-sync';
import { showSuccess } from '@/lib/utils/toast';

/**
 * Fallback for browsers without Background Sync API.
 * Listens for 'online' events and replays queued form submissions.
 */
export default function BackgroundSyncReplay() {
  useEffect(() => {
    const handleOnline = async () => {
      const pending = await getPendingRequests();
      if (pending.length === 0) return;

      const replayed = await replayQueue();
      if (replayed > 0) {
        showSuccess(
          `${replayed} queued ${replayed === 1 ? 'submission' : 'submissions'} sent successfully.`
        );
      }
    };

    window.addEventListener('online', handleOnline);

    // Also replay on mount if online and there are pending items
    if (navigator.onLine) {
      handleOnline();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return null;
}
