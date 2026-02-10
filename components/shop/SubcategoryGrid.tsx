'use client';

import { HierarchicalCategory } from '@/lib/products/combined-service';
import CategoryCard from './CategoryCard';

interface SubcategoryGridProps {
  subcategories: HierarchicalCategory[];
  parentSlug: string;
  parentName?: string;
}

// Simple plural-to-singular conversion for category names
function toSingular(name: string): string {
  // Handle compound names - only singularize the last word
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1];
  const lower = last.toLowerCase();

  // Common irregular plurals
  const irregulars: Record<string, string> = {
    women: 'Woman',
    men: 'Man',
    children: 'Child',
    accessories: 'Accessory',
    supplies: 'Supply',
    batteries: 'Battery',
    novelties: 'Novelty',
    categories: 'Category',
    parties: 'Party',
  };
  if (irregulars[lower]) {
    words[words.length - 1] = irregulars[lower];
    return words.join(' ');
  }

  // Don't singularize words that already look singular or end in 's' naturally
  if (lower.endsWith('ss') || lower.endsWith('us') || lower.length <= 3) {
    return name;
  }

  let singular = last;
  if (lower.endsWith('ies')) {
    singular = last.slice(0, -3) + 'y';
  } else if (lower.endsWith('ves')) {
    singular = last.slice(0, -3) + 'f';
  } else if (
    lower.endsWith('ses') ||
    lower.endsWith('xes') ||
    lower.endsWith('zes') ||
    lower.endsWith('ches') ||
    lower.endsWith('shes')
  ) {
    singular = last.slice(0, -2);
  } else if (lower.endsWith('s') && !lower.endsWith('ss')) {
    singular = last.slice(0, -1);
  }

  words[words.length - 1] = singular;
  return words.join(' ');
}

export default function SubcategoryGrid({
  subcategories,
  parentSlug,
  parentName,
}: SubcategoryGridProps) {
  // Filter to only show categories with products
  const activeSubcategories = subcategories.filter((cat) => cat.count > 0);

  if (activeSubcategories.length === 0) return null;

  const singularName = parentName ? toSingular(parentName) : '';

  return (
    <section className='mb-10'>
      <div className='flex items-center justify-between mb-6'>
        <div>
          <h2 className='text-xl font-bold text-foreground'>
            Browse {singularName ? `${singularName} ` : ''}Subcategories
          </h2>
          <p className='text-muted-foreground text-sm mt-1'>
            Explore specific types within this category
          </p>
        </div>
      </div>

      {/* Subcategories Grid */}
      <div className='grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3'>
        {activeSubcategories.map((subcategory) => (
          <CategoryCard key={subcategory.id} category={subcategory} />
        ))}
      </div>
    </section>
  );
}
