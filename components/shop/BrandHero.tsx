'use client';

import { Brand } from '@/lib/products/combined-service';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

interface BrandHeroProps {
  brand: Brand;
  productCount: number;
}

export default function BrandHero({ brand, productCount }: BrandHeroProps) {
  return (
    <section className="mb-8">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/90 to-primary-hover/90">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>

        {/* Content */}
        <div className="relative px-6 py-8 sm:px-8 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Brand Icon */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 p-4 bg-white/20 rounded-2xl backdrop-blur-sm flex-shrink-0 text-white flex items-center justify-center">
              <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>

            {/* Text Content */}
            <div className="flex-1">
              {/* Breadcrumb */}
              <div className="drop-shadow-md [&_nav]:mb-2">
                <Breadcrumbs
                  variant="light"
                  items={[
                    { label: 'Shop', href: '/shop' },
                    { label: 'Brands', href: '/brands' },
                    { label: brand.name },
                  ]}
                />
              </div>

              {/* Title */}
              <h1 className="text-white text-3xl sm:text-4xl font-bold mb-2 drop-shadow-lg">
                {brand.name}
              </h1>

              {/* Description */}
              {brand.description && (
                <p
                  className="text-white/90 text-sm sm:text-base mb-3 max-w-2xl drop-shadow-md"
                  dangerouslySetInnerHTML={{ __html: brand.description }}
                />
              )}

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-4 text-white/90 drop-shadow-md">
                <span className="flex items-center gap-1.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  {productCount} {productCount === 1 ? 'product' : 'products'}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="hidden sm:flex flex-col gap-2">
              <a
                href="#products"
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-medium transition-colors backdrop-blur-sm text-center"
              >
                Browse Products
              </a>
            </div>
          </div>
        </div>

        {/* Decorative Elements */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-black/10 rounded-full blur-3xl" />
      </div>

      {/* Mobile Quick Actions */}
      <div className="flex sm:hidden gap-2 mt-4">
        <a
          href="#products"
          className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary to-primary-hover text-white rounded-lg text-sm font-medium text-center"
        >
          Browse Products
        </a>
      </div>
    </section>
  );
}
