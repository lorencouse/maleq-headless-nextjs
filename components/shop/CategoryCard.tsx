'use client';

import Link from 'next/link';
import Image from 'next/image';
import { HierarchicalCategory } from '@/lib/products/combined-service';
import {
  getCategoryConfig,
  getCategoryImage,
} from '@/lib/config/category-icons';

interface CategoryCardProps {
  category: HierarchicalCategory;
}

export default function CategoryCard({ category }: CategoryCardProps) {
  const config = getCategoryConfig(category.slug);
  const categoryImage = getCategoryImage(category.slug, category.image);

  return (
    <Link
      href={`/product-category/${category.slug}`}
      className='group relative overflow-hidden rounded-xl aspect-square'
    >
      {/* Background Image or Gradient */}
      {categoryImage ? (
        <Image
          src={categoryImage}
          alt={category.name}
          fill
          className='object-cover transition-transform group-hover:scale-105'
          sizes='(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 16vw'
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
        <div className='absolute inset-x-0 bottom-0 h-1/3 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-between px-3 py-2 text-center'>
          <span className='text-white font-bold text-sm sm:text-base leading-5 line-clamp-2'>
            {category.name}
          </span>
          <span className='text-white/90 text-xs leading-none'>
            {category.count} {category.count === 1 ? 'item' : 'items'}
          </span>
        </div>
      ) : (
        <div className='relative h-full flex flex-col justify-between px-4'>
          <div className='text-white opacity-80 group-hover:opacity-100 transition-opacity'>
            {config.icon}
          </div>
          <div>
            <h3 className='heading-plain text-white font-bold text-sm sm:text-base leading-tight line-clamp-2'>
              {category.name}
            </h3>
            <p className='text-white/90 text-xs'>
              {category.count} {category.count === 1 ? 'item' : 'items'}
            </p>
          </div>
        </div>
      )}
    </Link>
  );
}
