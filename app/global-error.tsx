'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { isChunkLoadError, recoverFromStaleChunks } from '@/lib/utils/chunk-reload';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Stale app shell vs. a fresh deploy → reload onto the live build once.
    if (isChunkLoadError(error)) recoverFromStaleChunks();
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center max-w-lg">
            {/* Error Icon */}
            <div className="mb-8">
              <div className="w-24 h-24 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-12 h-12 text-destructive"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            <h1 className="heading-plain heading-display text-3xl md:text-4xl text-foreground mb-4">
              Something Went Wrong
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Something broke badly on our end. A refresh usually fixes it.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-[0.12em] rounded-lg hover:bg-primary-hover transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Try Again
              </button>
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground text-sm font-bold uppercase tracking-[0.12em] rounded-lg hover:bg-muted transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
                Go Home
              </Link>
            </div>

            {/* Error ID for support */}
            {error.digest && (
              <p className="text-xs text-muted-foreground mt-8">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
