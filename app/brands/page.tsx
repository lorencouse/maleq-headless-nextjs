import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { getBrands } from '@/lib/products/combined-service';
import ShopSearch from '@/components/shop/ShopSearch';

export const metadata: Metadata = {
  title: 'Shop by Brand',
  description: 'Browse our collection of top brands at Male Q. Find quality products from trusted manufacturers with fast, discreet shipping.',
  openGraph: {
    title: 'Shop by Brand | Male Q',
    description: 'Browse our collection of top brands at Male Q.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Shop by Brand | Male Q',
    description: 'Browse our collection of top brands at Male Q.',
  },
  alternates: {
    canonical: '/brands',
  },
};

// ISR: Revalidate weekly — webhook handles real-time invalidation on product updates
export const revalidate = 604800;

export default async function BrandsPage() {
  const brands = await getBrands();

  // Group brands by first letter
  const groupedBrands = brands.reduce((acc, brand) => {
    const firstLetter = brand.name.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(firstLetter) ? firstLetter : '#';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(brand);
    return acc;
  }, {} as Record<string, typeof brands>);

  // Sort the keys alphabetically with '#' at the end
  const sortedKeys = Object.keys(groupedBrands).sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Hero Section */}
      <div className="mb-12">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/shop" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span>/</span>
          <span className="text-foreground">Brands</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
            Shop by Brand
          </h1>
          <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
            <ShopSearch />
          </Suspense>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Explore our curated selection of {brands.length} premium brands. From industry leaders to specialty manufacturers, find the quality products you're looking for.
        </p>
      </div>

      {/* Quick Jump Navigation */}
      <div className="mb-8 flex flex-wrap gap-2">
        {sortedKeys.map((letter) => (
          <a
            key={letter}
            href={`#letter-${letter}`}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-card border border-border text-sm font-medium text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
          >
            {letter}
          </a>
        ))}
      </div>

      {/* Brands List */}
      <div className="space-y-12">
        {sortedKeys.map((letter) => (
          <section key={letter} id={`letter-${letter}`}>
            <div className="flex items-center gap-4 mb-6">
              <span className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
                {letter}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {groupedBrands[letter].map((brand) => (
                <Link
                  key={brand.id}
                  href={`/brand/${brand.slug}`}
                  className="group p-4 rounded-lg bg-card border border-border hover:border-primary hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {brand.name}
                    </span>
                    <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {brand.count}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Back to top */}
      <div className="mt-12 text-center">
        <a
          href="#"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          Back to top
        </a>
      </div>
    </div>
  );
}
