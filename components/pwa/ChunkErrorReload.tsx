'use client';

import { useEffect } from 'react';
import {
  isChunkLoadError,
  isNextChunkResourceError,
  recoverFromStaleChunks,
} from '@/lib/utils/chunk-reload';

/**
 * Auto-recovers from the "stale app shell after deploy" failure (ChunkLoadError).
 * Mounts global listeners that catch failed chunk loads — whether they surface as
 * a rejected dynamic import, a failed <script>/<link> resource, or a thrown
 * ChunkLoadError — and trigger a single guarded hard reload onto the live build.
 * See lib/utils/chunk-reload.ts. Renders nothing.
 */
export default function ChunkErrorReload() {
  useEffect(() => {
    // Rejected dynamic import() — the most common path (Next route/code-split).
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) recoverFromStaleChunks();
    };

    // Thrown errors, plus failed resource loads for <script>/<link> chunks
    // (resource errors don't bubble, so we capture).
    const onError = (e: ErrorEvent | Event) => {
      if ('message' in e && isChunkLoadError((e as ErrorEvent).error ?? (e as ErrorEvent).message)) {
        recoverFromStaleChunks();
        return;
      }
      if (isNextChunkResourceError(e)) recoverFromStaleChunks();
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError, true);

    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError, true);
    };
  }, []);

  return null;
}
