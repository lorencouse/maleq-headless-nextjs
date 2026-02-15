import { Suspense } from 'react';
import Link from 'next/link';
import Log404 from '@/components/analytics/Log404';
import NotFoundSuggestions from '@/components/analytics/NotFoundSuggestions';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <Log404 />
      <div className="text-center max-w-2xl w-full">
        {/* 404 Illustration */}
        <div className="mb-6">
          <div className="text-8xl font-bold text-primary/20">404</div>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          Page Not Found
        </h1>
        <p className="text-lg text-muted-foreground mb-6">
          Oops! The page you&apos;re looking for doesn&apos;t exist or has been moved.
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
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Go Home
          </Link>
          <Link
            href="/shop"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Browse Shop
          </Link>
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
