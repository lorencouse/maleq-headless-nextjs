'use client';

import { useEffect, useState } from 'react';
import type { GalleryProductImage } from '@/lib/types/product';

interface DevImageImporterProps {
  slug: string;
  images: GalleryProductImage[];
}

/**
 * Development-only component that auto-imports product images when they 404.
 * Checks the featured image on mount; if missing, calls the dev import API
 * and reloads the page once images are ready.
 */
export default function DevImageImporter({ slug, images }: DevImageImporterProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'importing' | 'done' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    if (!isDev) return;
    // No images at all — nothing to check
    if (!images || images.length === 0) return;

    const featuredImage = images.find(img => img.isPrimary) || images[0];
    if (!featuredImage?.url) return;

    let cancelled = false;

    async function checkAndImport() {
      setStatus('checking');

      try {
        // HEAD request to check if the featured image exists
        const res = await fetch(featuredImage.url, { method: 'HEAD' });

        if (res.ok || cancelled) {
          setStatus('idle');
          return;
        }
      } catch {
        // Network error or CORS — image likely missing
      }

      if (cancelled) return;

      // Image is missing, trigger import
      setStatus('importing');

      try {
        const res = await fetch('/api/dev/import-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });

        const data = await res.json();

        if (cancelled) return;

        if (data.success && !data.skipped) {
          setStatus('done');
          // Reload after a short delay to pick up new images
          setTimeout(() => window.location.reload(), 500);
        } else if (data.skipped) {
          setStatus('idle');
        } else {
          setStatus('error');
          setErrorMessage(data.error || 'Import failed');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : 'Network error');
        }
      }
    }

    checkAndImport();

    return () => {
      cancelled = true;
    };
  }, [slug, images, isDev]);

  if (!isDev || status === 'idle' || status === 'checking') return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm">
      {status === 'importing' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-600 text-white text-sm font-medium rounded-lg shadow-lg">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Importing images...
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg shadow-lg">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Images imported! Reloading...
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-600 text-white text-sm font-medium rounded-lg shadow-lg">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Image import failed: {errorMessage}
        </div>
      )}
    </div>
  );
}
