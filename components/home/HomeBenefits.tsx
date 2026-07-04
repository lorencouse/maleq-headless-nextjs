import { useTranslations } from 'next-intl';

// Static config: icon + color + translation key pairs. Labels are resolved at
// render time via useTranslations('home.benefits') so they track the active
// locale. Same pattern as account sidebar and checkout step indicator.
const benefits = [
  {
    titleKey: 'discreetPackagingTitle' as const,
    descKey: 'discreetPackagingDesc' as const,
    icon: (
      <svg
        className='w-8 h-8'
        fill='none'
        stroke='currentColor'
        viewBox='0 0 24 24'
        strokeWidth={1.5}
      >
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          d='M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z'
        />
      </svg>
    ),
  },
  {
    titleKey: 'secureCheckoutTitle' as const,
    descKey: 'secureCheckoutDesc' as const,
    icon: (
      <svg
        className='w-8 h-8'
        fill='none'
        stroke='currentColor'
        viewBox='0 0 24 24'
        strokeWidth={1.5}
      >
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          d='M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'
        />
      </svg>
    ),
  },
  {
    titleKey: 'fastShippingTitle' as const,
    descKey: 'fastShippingDesc' as const,
    icon: (
      <svg
        className='w-8 h-8'
        fill='none'
        stroke='currentColor'
        viewBox='0 0 24 24'
        strokeWidth={1.5}
      >
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          d='M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12'
        />
      </svg>
    ),
  },
  {
    titleKey: 'qualityGuaranteedTitle' as const,
    descKey: 'qualityGuaranteedDesc' as const,
    icon: (
      <svg
        className='w-8 h-8'
        fill='none'
        stroke='currentColor'
        viewBox='0 0 24 24'
        strokeWidth={1.5}
      >
        <path
          strokeLinecap='round'
          strokeLinejoin='round'
          d='M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z'
        />
      </svg>
    ),
  },
];

export default function HomeBenefits() {
  const t = useTranslations('home.benefits');

  return (
    <section className='border-y border-border select-none'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14'>
        <div className='mb-8 sm:mb-10'>
          <span className='kicker' aria-hidden='true'></span>
          <h2 className='heading-plain heading-display mt-1 text-2xl sm:text-3xl text-foreground'>
            {t('title')}
          </h2>
          <p className='mt-2 text-sm text-muted-foreground max-w-2xl'>{t('subtitle')}</p>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-y-8 gap-x-8 lg:gap-x-0 lg:divide-x lg:divide-border'>
          {benefits.map((benefit, index) => (
            <div key={index} className='lg:px-8 lg:first:pl-0 lg:last:pr-0'>
              <div className='flex items-center gap-2.5 mb-2.5 text-foreground [&>svg]:w-6 [&>svg]:h-6 [&>svg]:flex-shrink-0'>
                {benefit.icon}
                <h3 className='heading-plain text-xs font-bold uppercase tracking-[0.14em] text-foreground mb-0'>
                  {t(benefit.titleKey)}
                </h3>
              </div>
              <p className='text-sm text-muted-foreground leading-relaxed mb-0'>
                {t(benefit.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
