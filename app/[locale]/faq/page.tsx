import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import FaqAccordion from '@/components/faq/FaqAccordion';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'faq' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: '/faq',
    },
  };
}

/**
 * Static config — icons + categorySubKey + ordered list of question/answer
 * key suffixes. Display strings come from `faq.<categorySubKey>.<keyName>`
 * at render time so categories track the active locale.
 *
 * The one special-case item (privacyShipping.discreet) renders a custom JSX
 * answer with an embedded image; everything else uses plain-text answers.
 */
const FAQ_STRUCTURE = [
  {
    categoryKey: 'ordersShipping' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
    items: ['shippingTime', 'tracking', 'multiPackage', 'international', 'carriers'] as const,
  },
  {
    categoryKey: 'privacyShipping' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    items: ['discreet', 'billingName'] as const,
  },
  {
    categoryKey: 'returns' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
      </svg>
    ),
    items: ['cancel', 'policy', 'bounced', 'broken'] as const,
  },
  {
    categoryKey: 'payment' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    items: ['methods', 'currencies', 'secure', 'plans', 'declined'] as const,
  },
  {
    categoryKey: 'account' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    items: ['needAccount', 'resetPassword', 'coupon'] as const,
  },
  {
    categoryKey: 'products' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    items: ['authentic', 'outOfStock', 'size'] as const,
  },
  {
    categoryKey: 'productCare' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
    items: ['clean', 'store', 'lube', 'replace'] as const,
  },
  {
    categoryKey: 'healthSafety' as const,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    items: ['disclaimer'] as const,
  },
];

interface FaqItem {
  question: string;
  answer: ReactNode;
  /** Plain-text version of answer for JSON-LD structured data. */
  answerText: string;
}

export default function FaqPage() {
  const t = useTranslations('faq');

  // Resolve all categories + items at render time so titles, questions, and
  // answers are locale-aware. The privacyShipping/discreet item is special-
  // cased to render its answer with an inline image.
  const faqCategories = FAQ_STRUCTURE.map((cat) => {
    const items: FaqItem[] = cat.items.map((itemKey) => {
      const qKey = `${cat.categoryKey}.${itemKey}Q` as const;
      const aKey = `${cat.categoryKey}.${itemKey}A` as const;
      const answerText = t(aKey);
      const question = t(qKey);

      // Custom render for the one Q with an embedded image
      if (cat.categoryKey === 'privacyShipping' && itemKey === 'discreet') {
        return {
          question,
          answer: (
            <div>
              <p>{answerText}</p>
              <Image
                src="/images/discreet-shipping.jpg"
                alt={t('discreetShippingImageAlt')}
                width={500}
                height={300}
                className="mt-4 rounded-lg border border-border"
              />
            </div>
          ),
          answerText,
        };
      }

      return { question, answer: answerText, answerText };
    });

    return {
      title: t(`${cat.categoryKey}.title`),
      icon: cat.icon,
      items,
    };
  });

  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            {t('pageHeading')}
          </h1>
          <p className="text-lg text-muted-foreground">
            {t('pageSubtitle')}
          </p>
        </div>

        {/* FAQ Categories */}
        <div className="space-y-12">
          {faqCategories.map((category, categoryIndex) => (
            <section key={categoryIndex}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  {category.icon}
                </div>
                <h2 className="text-2xl font-semibold text-foreground">
                  {category.title}
                </h2>
              </div>
              <FaqAccordion items={category.items} />
            </section>
          ))}
        </div>

        {/* Still Have Questions */}
        <div className="mt-16 text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t('stillQuestionsHeading')}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t('stillQuestionsBody')}
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
          >
            {t('contactSupport')}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Structured Data for SEO — locale-aware via the same translation pass */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqCategories.flatMap((category) =>
              category.items.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: item.answerText,
                },
              }))
            ),
          }),
        }}
      />
    </div>
  );
}
