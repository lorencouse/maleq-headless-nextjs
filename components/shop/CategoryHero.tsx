'use client';

import Image from 'next/image';
import { HierarchicalCategory } from '@/lib/products/combined-service';
import { getCategoryConfig, getCategoryImage } from '@/lib/config/category-icons';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

interface CategoryHeroProps {
  category: HierarchicalCategory;
  productCount: number;
  parentCategory?: { name: string; slug: string } | null;
}

export default function CategoryHero({ category, productCount, parentCategory }: CategoryHeroProps) {
  const config = getCategoryConfig(category.slug);
  const categoryImage = getCategoryImage(category.slug, category.image);

  return (
    <section className="mb-8 select-none">
      {/* Hero Banner */}
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${config.gradient}`}>
        {/* Pattern Overlay */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>

        {/* Content */}
        <div className="relative px-6 py-8 sm:px-8 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Category Image (centered, not stretched) or Icon */}
            {categoryImage ? (
              <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-white/20 backdrop-blur-sm">
                <Image
                  src={categoryImage}
                  alt={category.name}
                  width={96}
                  height={96}
                  className="w-full h-full object-contain"
                  sizes="96px"
                  priority
                />
              </div>
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 p-4 bg-white/20 rounded-2xl backdrop-blur-sm flex-shrink-0 text-white">
                {config.icon}
              </div>
            )}

            {/* Text Content */}
            <div className="flex-1">
              {/* Breadcrumb */}
              <div className="drop-shadow-md [&_nav]:mb-2">
                <Breadcrumbs
                  variant="light"
                  items={[
                    { label: 'Shop', href: '/shop' },
                    ...(parentCategory
                      ? [{ label: parentCategory.name, href: `/product-category/${parentCategory.slug}` }]
                      : []),
                    { label: category.name },
                  ]}
                />
              </div>

              {/* Title */}
              <h1 className="text-white text-3xl sm:text-4xl font-bold mb-2 drop-shadow-lg">
                {category.name}
              </h1>

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-4 text-white/90 drop-shadow-md">
                <span className="flex items-center gap-1.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  {productCount} {productCount === 1 ? 'product' : 'products'}
                </span>
                {category.children && category.children.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {category.children.filter(c => c.count > 0).length} subcategories
                  </span>
                )}
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
              {category.children && category.children.length > 0 && (
                <a
                  href="#subcategories"
                  className="px-4 py-2 border border-white/30 hover:bg-white/10 rounded-lg text-white text-sm font-medium transition-colors text-center"
                >
                  View Subcategories
                </a>
              )}
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
          className={`flex-1 px-4 py-2.5 bg-gradient-to-r ${config.gradient} text-white rounded-lg text-sm font-medium text-center`}
        >
          Browse Products
        </a>
        {category.children && category.children.length > 0 && (
          <a
            href="#subcategories"
            className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground text-center hover:bg-muted transition-colors"
          >
            Subcategories
          </a>
        )}
      </div>
    </section>
  );
}
