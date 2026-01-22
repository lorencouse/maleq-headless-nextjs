'use client';

import Link from 'next/link';
import Image from 'next/image';
import { HierarchicalCategory } from '@/lib/products/combined-service';
import {
  getCategoryConfig,
  getCategoryImage,
} from '@/lib/config/category-icons';

interface SubcategoryGridProps {
  subcategories: HierarchicalCategory[];
  parentSlug: string;
}

export default function SubcategoryGrid({
  subcategories,
  parentSlug,
}: SubcategoryGridProps) {
  // Filter to only show categories with products
  const activeSubcategories = subcategories.filter((cat) => cat.count > 0);

  if (activeSubcategories.length === 0) return null;

  return (
    <section className='mb-10'>
      <div className='flex items-center justify-between mb-6'>
        <div>
          <h2 className='text-xl font-bold text-foreground'>
            Browse Subcategories
          </h2>
          <p className='text-muted-foreground text-sm mt-1'>
            Explore specific types within this category
          </p>
        </div>
      </div>

      {/* Subcategories Grid */}
      <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'>
        {activeSubcategories.map((subcategory) => {
          const config = getCategoryConfig(subcategory.slug);
          const categoryImage = getCategoryImage(subcategory.slug);

          return (
            <Link
              key={subcategory.id}
              href={`/shop/category/${subcategory.slug}`}
              className='group relative overflow-hidden rounded-xl aspect-[3/2] sm:aspect-[4/3]'
            >
              {/* Background Image or Gradient */}
              {categoryImage ? (
                <Image
                  src={categoryImage}
                  alt={subcategory.name}
                  fill
                  className='object-cover transition-transform group-hover:scale-105'
                  sizes='(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
                />
              ) : (
                <>
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${config.gradient} transition-transform group-hover:scale-105`}
                  />
                  {/* Pattern Overlay */}
                  <div className='absolute inset-0 opacity-10'>
                    <div
                      className='absolute inset-0'
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.4' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3Ccircle cx='13' cy='13' r='3'/%3E%3C/g%3E%3C/svg%3E")`,
                      }}
                    />
                  </div>
                </>
              )}

              {/* Content - Centered translucent bar for images, bottom content for gradients */}
              {categoryImage ? (
                <div className='absolute inset-0 flex items-center justify-center'>
                  <div className='flex flex-col justify-around items-center w-full bg-black/40 backdrop-blur-sm pt-4 px-3 text-center'>
                    <h3 className='text-white font-semibold text-xs sm:text-sm leading-tight line-clamp-2'>
                      {subcategory.name}
                    </h3>
                    <p className='text-white/90 text-[10px] sm:text-xs mt-0.5'>
                      {subcategory.count}{' '}
                      {subcategory.count === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className='relative h-full flex flex-col justify-between p-3 sm:p-4'>
                  <div className='w-6 h-6 sm:w-7 sm:h-7 text-white opacity-80 group-hover:opacity-100 transition-opacity'>
                    {config.icon}
                  </div>
                  <div>
                    <h3 className='text-white font-semibold text-xs sm:text-sm leading-tight mb-0.5 line-clamp-2'>
                      {subcategory.name}
                    </h3>
                    <p className='text-white/90 text-[10px] sm:text-xs'>
                      {subcategory.count}{' '}
                      {subcategory.count === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
