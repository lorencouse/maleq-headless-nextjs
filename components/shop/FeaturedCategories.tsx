'use client';

import Link from 'next/link';
import Image from 'next/image';
import { HierarchicalCategory } from '@/lib/products/combined-service';

interface FeaturedCategoriesProps {
  categories: HierarchicalCategory[];
}

// Define which categories to feature and in what order
const FEATURED_CATEGORY_SLUGS = [
  'anal-toys',
  'vibrators',
  'dildos',
  'male-masturbators',
  'lubricants',
  'bondage',
  'lingerie',
  'couples-toys',
];

// Category display config with icons and colors
const categoryConfig: Record<string, { icon: React.ReactNode; gradient: string }> = {
  'anal-toys': {
    gradient: 'from-purple-500 to-purple-700',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
    ),
  },
  'vibrators': {
    gradient: 'from-pink-500 to-rose-600',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  'dildos': {
    gradient: 'from-indigo-500 to-indigo-700',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
  'male-masturbators': {
    gradient: 'from-blue-500 to-blue-700',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  'lubricants': {
    gradient: 'from-cyan-500 to-teal-600',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
  },
  'bondage': {
    gradient: 'from-red-500 to-red-700',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  'lingerie': {
    gradient: 'from-fuchsia-500 to-fuchsia-700',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  'couples-toys': {
    gradient: 'from-amber-500 to-orange-600',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
};

// Default config for categories not in the list
const defaultConfig = {
  gradient: 'from-zinc-600 to-zinc-800',
  icon: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
};

// Flatten hierarchical categories to find all categories
function flattenCategories(categories: HierarchicalCategory[]): HierarchicalCategory[] {
  const result: HierarchicalCategory[] = [];

  function traverse(cats: HierarchicalCategory[]) {
    for (const cat of cats) {
      result.push(cat);
      if (cat.children && cat.children.length > 0) {
        traverse(cat.children);
      }
    }
  }

  traverse(categories);
  return result;
}

export default function FeaturedCategories({ categories }: FeaturedCategoriesProps) {
  const allCategories = flattenCategories(categories);

  // Get featured categories in order, falling back to top-level categories with highest count
  const featuredCategories = FEATURED_CATEGORY_SLUGS
    .map(slug => allCategories.find(c => c.slug === slug))
    .filter((c): c is HierarchicalCategory => c !== undefined && c.count > 0)
    .slice(0, 8);

  // If we don't have enough featured categories, fill with top categories by count
  if (featuredCategories.length < 8) {
    const remaining = allCategories
      .filter(c => !featuredCategories.some(fc => fc.slug === c.slug) && c.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8 - featuredCategories.length);
    featuredCategories.push(...remaining);
  }

  if (featuredCategories.length === 0) return null;

  return (
    <section id="categories" className="mb-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Shop by Category</h2>
          <p className="text-muted-foreground text-sm mt-1">Browse our most popular categories</p>
        </div>
        <Link
          href="/shop"
          className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
        >
          View All
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
        {featuredCategories.map((category) => {
          const config = categoryConfig[category.slug] || defaultConfig;

          return (
            <Link
              key={category.id}
              href={`/shop?category=${category.slug}`}
              className="group relative overflow-hidden rounded-xl aspect-[4/3] sm:aspect-square"
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient} transition-transform group-hover:scale-105`} />

              {/* Pattern Overlay */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0" style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.4' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3Ccircle cx='13' cy='13' r='3'/%3E%3C/g%3E%3C/svg%3E")`,
                }} />
              </div>

              {/* Content */}
              <div className="relative h-full flex flex-col justify-between p-4 text-white">
                <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                  {config.icon}
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base leading-tight mb-1 line-clamp-2">
                    {category.name}
                  </h3>
                  <p className="text-xs opacity-80">
                    {category.count} {category.count === 1 ? 'item' : 'items'}
                  </p>
                </div>
              </div>

              {/* Hover Arrow */}
              <div className="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Mobile View All Link */}
      <div className="mt-4 sm:hidden text-center">
        <Link
          href="/shop"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
        >
          View All Categories
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </section>
  );
}
