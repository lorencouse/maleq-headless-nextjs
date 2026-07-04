'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Brand } from '@/lib/products/combined-service';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { BRAND_LOGOS } from '@/lib/brand-logos';

interface BrandHeroProps {
  brand: Brand;
  productCount: number;
}

export default function BrandHero({ brand, productCount }: BrandHeroProps) {
  const t = useTranslations('brandHero');
  const logo = BRAND_LOGOS[brand.slug];
  return (
    <section className='mb-8 select-none'>
      {/* Hero Banner */}
      <div className='relative overflow-hidden bg-zinc-950 border-t-4 border-primary'>
        {/* Content */}
        <div className='relative px-6 py-8 sm:px-8 sm:py-12'>
          <div className='flex flex-col sm:flex-row sm:items-center gap-6'>
            {/* Brand logo when available, else generic icon. Dark-ink logos sit
                on a white tile; light/white-ink logos use a translucent dark
                tile so they read against the gradient hero. */}
            {logo ? (
              <div
                className={`px-4 py-6 rounded-2xl shadow-sm flex-shrink-0 flex items-center justify-center ${
                  logo.theme === 'dark'
                    ? 'bg-white/10 backdrop-blur-sm'
                    : 'bg-white'
                }`}
              >
                <Image
                  src={`/brand-logos/${brand.slug}.webp`}
                  alt={`${brand.name} logo`}
                  width={logo.w}
                  height={logo.h}
                  className='h-10 sm:h-12 w-auto object-contain'
                  priority
                />
              </div>
            ) : (
              <div className='min-w-16 min-h-16 sm:w-20 sm:h-20 p-4 bg-white/20 rounded-2xl backdrop-blur-sm flex-shrink-0 text-white flex items-center justify-center'>
                <svg
                  className='w-full h-full'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={1.5}
                    d='M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z'
                  />
                </svg>
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
                    { label: t('breadcrumbBrands'), href: '/brands' },
                    { label: brand.name },
                  ]}
                />
              </div>

              {/* Title */}
              <h1 className='text-white text-3xl sm:text-4xl font-bold mb-2'>
                {brand.name}
              </h1>

              {/* Description */}
              {brand.description && (
                <p
                  className='text-white/90 text-sm sm:text-base mb-3 max-w-2xl'
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(brand.description),
                  }}
                />
              )}

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
                {brand.website && (
                  <a
                    href={brand.website}
                    target='_blank'
                    rel='nofollow noopener noreferrer'
                    className='flex items-center gap-1.5 underline-offset-2 hover:underline'
                  >
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
                        d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18 15 15 0 010-18z'
                      />
                    </svg>
                    {t('officialWebsite')}
                  </a>
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
      </div>
    </section>
  );
}
