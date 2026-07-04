'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { HierarchicalCategory } from '@/lib/products/combined-service';
import {
  getCategoryConfig,
  getCategoryImage,
} from '@/lib/config/category-icons';
import { useLocalizedCategoryName } from '@/lib/i18n/category-translations';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

interface CategoryHeroProps {
  category: HierarchicalCategory;
  productCount: number;
  parentCategory?: { name: string; slug: string } | null;
}

export default function CategoryHero({
  category,
  productCount,
  parentCategory,
}: CategoryHeroProps) {
  const t = useTranslations('categoryHero');
  const localizeCategoryName = useLocalizedCategoryName();
  const config = getCategoryConfig(category.slug);
  const categoryImage = getCategoryImage(category.slug, category.image);
  const categoryName = localizeCategoryName(category.slug, category.name);
  const visibleSubcategoryCount =
    category.children?.filter((c) => c.count > 0).length ?? 0;

  return (
    <section className='mb-8 select-none'>
      {/* Hero Banner */}
      <div className='relative overflow-hidden bg-zinc-950 border-t-4 border-primary'>
        {/* Content */}
        <div className='relative px-6 py-8 sm:px-8 sm:py-12'>
          <div className='flex flex-col sm:flex-row sm:items-center gap-6'>
            {/* Category Image (centered, not stretched) or Icon */}
            {categoryImage ? (
              <div className='w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-white/20 backdrop-blur-sm'>
                <Image
                  src={categoryImage}
                  alt={categoryName}
                  width={96}
                  height={96}
                  className='w-full h-full object-contain'
                  sizes='96px'
                  priority
                />
              </div>
            ) : (
              <div className='w-16 h-16 sm:w-20 sm:h-20 p-4 bg-white/20 rounded-2xl backdrop-blur-sm flex-shrink-0 text-white'>
                {config.icon}
              </div>
            )}

            {/* Text Content */}
            <div className='flex-1'>
              {/* Breadcrumb */}
              <div className='[&_nav]:mb-2'>
                <Breadcrumbs
                  variant='light'
                  items={[
                    { label: t('breadcrumbShop'), href: '/shop' },
                    ...(parentCategory
                      ? [
                          {
                            label: localizeCategoryName(
                              parentCategory.slug,
                              parentCategory.name,
                            ),
                            href: `/sex-toys/${parentCategory.slug}`,
                          },
                        ]
                      : []),
                    { label: categoryName },
                  ]}
                />
              </div>

              {/* Title */}
              <h1 className='text-white text-3xl sm:text-4xl font-bold mb-2'>
                {categoryName}
              </h1>

              {/* Stats */}
              <div className='flex flex-wrap items-center gap-4 text-white/90'>
                <span className='flex items-center gap-1.5'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                    />
                  </svg>
                  {t('productCount', { count: productCount })}
                </span>
                {visibleSubcategoryCount > 0 && (
                  <span className='flex items-center gap-1.5'>
                    <svg
                      className='w-5 h-5'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10'
                      />
                    </svg>
                    {t('subcategoryCount', { count: visibleSubcategoryCount })}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className='hidden sm:flex flex-col gap-2'>
              <a
                href='#products'
                className='px-4 py-2 border border-white/40 hover:bg-white hover:text-zinc-950 rounded-lg text-white text-xs font-bold uppercase tracking-[0.12em] transition-colors text-center'
              >
                {t('browseProducts')}
              </a>
              {category.children && category.children.length > 0 && (
                <a
                  href='#subcategories'
                  className='px-4 py-2 border border-white/40 hover:bg-white hover:text-zinc-950 rounded-lg text-white text-xs font-bold uppercase tracking-[0.12em] transition-colors text-center'
                >
                  {t('viewSubcategories')}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Quick Actions */}
      <div className='flex sm:hidden gap-2 mt-4'>
        <a
          href='#products'
          className='flex-1 px-4 py-2.5 bg-zinc-950 border-t-4 border-primary text-white rounded-lg text-xs font-bold uppercase tracking-[0.12em] text-center'
        >
          {t('browseProducts')}
        </a>
        {category.children && category.children.length > 0 && (
          <a
            href='#subcategories'
            className='flex-1 px-4 py-2.5 border border-border rounded-lg text-xs font-bold uppercase tracking-[0.12em] text-foreground text-center hover:bg-muted transition-colors'
          >
            {t('subcategoriesMobile')}
          </a>
        )}
      </div>
    </section>
  );
}
