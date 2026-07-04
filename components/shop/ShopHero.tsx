'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function ShopHero() {
  const t = useTranslations('shopHero');

  // Promo cards are built at render time so titles/subtitles/CTAs translate
  // alongside the rest of the hero. Icons remain JSX since they're locale-free.
  const promoCards: {
    title: string;
    subtitle: string;
    cta: string;
    href: string;
    bgColor: string;
    icon: React.ReactNode;
  }[] = [
    {
      title: t('promoFreeShippingTitle'),
      subtitle: t('promoFreeShippingSubtitle'),
      cta: t('promoFreeShippingCta'),
      href: '/shop',
      bgColor: 'bg-primary',
      icon: (
        <svg
          className='w-8 h-8'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4'
          />
        </svg>
      ),
    },
    {
      title: t('promoSaleTitle'),
      subtitle: t('promoSaleSubtitle'),
      cta: t('promoSaleCta'),
      href: '/shop?onSale=true',
      bgColor: 'bg-zinc-900 border border-zinc-700',
      icon: (
        <svg
          className='w-8 h-8'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'
          />
        </svg>
      ),
    },
    {
      title: t('promoDiscreetTitle'),
      subtitle: t('promoDiscreetSubtitle'),
      cta: t('promoDiscreetCta'),
      href: '/shipping-returns',
      bgColor: 'bg-zinc-900 border border-zinc-700',
      icon: (
        <svg
          className='w-8 h-8'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
          />
        </svg>
      ),
    },
  ];

  return (
    <section className='mb-10 select-none'>
      {/* Main Hero Banner */}
      <div className='relative overflow-hidden bg-zinc-950 border-t-4 border-primary mb-6'>
        <div className='relative px-6 py-12 sm:px-12 sm:py-16 lg:py-20'>
          <div className='max-w-2xl'>
            <span className='kicker mb-4'>{t('eyebrow')}</span>
            <h1 className='heading-plain heading-display text-white text-4xl sm:text-5xl lg:text-6xl mb-4'>
              {t('title')}
            </h1>
            <p className='standfirst text-zinc-300 mb-8 max-w-lg'>
              {t('subtitle')}
            </p>
            <div className='flex flex-wrap gap-4'>
              <Link
                href='/shop?onSale=true'
                className='inline-flex items-center gap-2 px-6 py-3.5 bg-primary text-white text-xs sm:text-sm font-bold uppercase tracking-[0.14em] hover:bg-primary-hover transition-colors'
              >
                {t('ctaShopSale')}
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
                    d='M14 5l7 7m0 0l-7 7m7-7H3'
                  />
                </svg>
              </Link>
              <Link
                href='#categories'
                className='inline-flex items-center gap-2 px-6 py-3.5 border border-white/40 text-white text-xs sm:text-sm font-bold uppercase tracking-[0.14em] hover:bg-white hover:text-zinc-950 transition-colors'
              >
                {t('ctaBrowseCategories')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Promo Cards */}
      <div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
        {promoCards.map((card, index) => (
          <div
            key={index}
            className={`group overflow-hidden ${card.bgColor} px-6 py-5`}
          >
            <div className='flex items-center gap-4'>
              <div className='text-white opacity-90'>{card.icon}</div>
              <h3 className='heading-plain text-white font-bold text-sm uppercase tracking-[0.12em] mb-0'>
                {card.title}
              </h3>
            </div>
            <p className='text-white/70 text-sm ml-12 mb-0'>{card.subtitle}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
