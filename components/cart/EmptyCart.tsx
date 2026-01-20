'use client';

import Link from 'next/link';

export default function EmptyCart() {
  return (
    <div className="text-center py-16 px-4">
      {/* Cart Icon */}
      <div className="mb-6">
        <svg
          className="w-24 h-24 mx-auto text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-2xl font-semibold text-foreground mb-2">
        Your cart is empty
      </h2>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">
        Looks like you haven't added any items to your cart yet.
        Browse our collection and find something you'll love!
      </p>

      {/* Action Button */}
      <Link
        href="/shop"
        className="inline-block py-3 px-8 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
      >
        Start Shopping
      </Link>

      {/* Additional Links */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
        <Link
          href="/"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          Return to Home
        </Link>
        <span className="hidden sm:inline text-muted-foreground">|</span>
        <Link
          href="/shop"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          Browse Categories
        </Link>
      </div>
    </div>
  );
}
