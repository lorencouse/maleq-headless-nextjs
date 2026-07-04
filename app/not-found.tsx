import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { routing } from '@/i18n/routing';
import Log404 from '@/components/analytics/Log404';
import NotFoundSuggestions from '@/components/analytics/NotFoundSuggestions';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';

// The global not-found renders directly in the root layout, which no longer
// includes the storefront chrome (that moved to the locale-aware sub-layouts).
// This page is intentionally a self-contained standalone screen — it has its
// own search bar, suggestions, and Home/Shop links for navigation — matching
// error.tsx. (Wrapping it in <StorefrontChrome> half-renders: the Next.js
// not-found render path skips the client Header's SSR output, leaving a Footer
// with no Header, which looks worse than a clean standalone page.)
export default function NotFound() {
  // Seed next-intl's per-request locale cache with a static literal so any
  // next-intl resolution in this subtree reads the cached default instead of
  // falling back to headers(). Reading headers() forces this 404 to render
  // DYNAMICALLY ("changed from static to dynamic at runtime, reason: headers"),
  // which means a full SSR per crawler 404 hit — a major source of load.
  setRequestLocale(routing.defaultLocale);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Log404 />
      <div className="text-center max-w-2xl w-full">
        {/* 404 Illustration */}
        <div className="mb-6">
          <div className="text-8xl font-bold text-primary/20">404</div>
        </div>

        <h1 className="heading-plain heading-display text-3xl md:text-4xl text-foreground mb-3">
          Page Not Found
        </h1>
        <p className="text-lg text-muted-foreground mb-6">
          This page doesn&apos;t exist — or it moved. The good stuff is still here.
        </p>

        {/* Search Bar */}
        <div className="mb-8">
          <Suspense fallback={
            <div className="h-12 rounded-lg border border-border bg-muted animate-pulse" />
          }>
            <SearchAutocomplete autoFocus={false} />
          </Suspense>
        </div>

        {/* Smart Suggestions */}
        <NotFoundSuggestions />

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <ButtonLink href="/">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Go Home
          </ButtonLink>
          <ButtonLink href="/shop" variant="ghost">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Browse Shop
          </ButtonLink>
        </div>

        {/* Helpful Links */}
        <div className="border-t border-border pt-8 pb-8">
          <p className="text-sm text-muted-foreground mb-4">Looking for something specific?</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link href="/contact" className="text-primary hover:underline">
              Contact Support
            </Link>
            <span className="text-border">|</span>
            <Link href="/faq" className="text-primary hover:underline">
              FAQ
            </Link>
            <span className="text-border">|</span>
            <Link href="/search" className="text-primary hover:underline">
              Search Products
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
