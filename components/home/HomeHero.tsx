import { Suspense } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import SearchAutocomplete from '@/components/search/SearchAutocomplete';

/**
 * Newsstand cover story: solid ink field under a red top rule, caps kicker,
 * condensed display headline, serif standfirst, house-style CTAs, and a
 * tracked-caps dateline strip for trust signals. No gradients, no blobs.
 */
export default function HomeHero() {
  const t = useTranslations('home.hero');
  return (
    <section className='relative bg-zinc-950 text-white select-none border-t-4 border-primary'>
      <div className='relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24'>
        <div className='max-w-3xl'>
          {/* Brand kicker */}
          <p className='kicker mb-6'>Male Q</p>

          {/* Cover headline */}
          <h1 className='heading-plain heading-display text-5xl sm:text-6xl lg:text-7xl mb-6'>
            {t('headingMain')}
            <br />
            <span className='text-primary'>{t('headingAccent')}</span>
          </h1>

          {/* Standfirst */}
          <p className='standfirst mb-8 max-w-2xl text-zinc-300'>
            {t('subheading')}
          </p>

          {/* CTAs — house buttons: sharp, caps, tracked */}
          <div className='flex flex-col sm:flex-row gap-3'>
            <Link
              href='/shop'
              className='inline-flex items-center justify-center gap-2 bg-primary text-white px-8 py-4 text-sm font-bold uppercase tracking-[0.14em] hover:bg-primary-hover transition-colors'
            >
              {t('shopNow')}
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2.5}
                  d='M17 8l4 4m0 0l-4 4m4-4H3'
                />
              </svg>
            </Link>
            <Link
              href='/guides'
              className='inline-flex items-center justify-center gap-2 bg-white text-zinc-950 px-8 py-4 text-sm font-bold uppercase tracking-[0.14em] hover:bg-zinc-200 transition-colors'
            >
              {t('exploreGuides')}
            </Link>
          </div>

          {/* Search — Suspense-wrapped because SearchAutocomplete reads
              useSearchParams(); unwrapped it fails the static home build. */}
          <div className='mt-6 max-w-xl'>
            <Suspense fallback={<div className='h-[42px] rounded-lg bg-white/10 animate-pulse' />}>
              <SearchAutocomplete />
            </Suspense>
          </div>

          {/* Dateline strip — trust signals as tracked caps over a hairline */}
          <div className='flex flex-wrap gap-x-5 gap-y-2.5 sm:gap-x-8 sm:gap-y-3 mt-10 pt-6 border-t border-white/15 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400'>
            <span className='text-zinc-300'>{t('socialProof')}</span>
            <Link href='/privacy' className='hover:text-white transition-colors'>
              {t('trustSecureCheckout')}
            </Link>
            <Link href='/shipping-returns' className='hover:text-white transition-colors'>
              {t('trustPlainPackaging')}
            </Link>
            <Link href='/shipping-returns' className='hover:text-white transition-colors'>
              {t('trustFastShipping')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
