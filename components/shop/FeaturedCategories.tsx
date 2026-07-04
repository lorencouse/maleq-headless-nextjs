'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { HierarchicalCategory } from '@/lib/products/combined-service';
import CategoryCard from './CategoryCard';
import SectionHeader from '@/components/ui/SectionHeader';

interface FeaturedCategoriesProps {
  categories: HierarchicalCategory[];
}

// Define which categories to feature and in what order
const FEATURED_CATEGORY_SLUGS = [
  'vibrators',
  'dildos-dongs',
  'anal-toys',
  'masturbators',
  'lubricants',
  'bondage-fetish-kink',
  'lingerie-clothing',
  'sextoys-for-couples',
];

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
  const t = useTranslations('shop');
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
      <SectionHeader
        title={t('shopByCategory')}
        subtitle={t('shopByCategorySubtitle')}
      />

      {/* Categories Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {featuredCategories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      </div>

      {/* View All Link */}
      <div className="mt-6 text-center">
        <Link
          href="/shop"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
        >
          {t('viewAllCategories')}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </section>
  );
}
