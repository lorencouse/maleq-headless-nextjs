import { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'shippingReturnsPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/shipping-returns' },
  };
}

export default function ShippingReturnsPage() {
  const t = useTranslations('shippingReturnsPage');

  // Rich-text bold span used in several body paragraphs
  const strong = (chunks: React.ReactNode) => <strong className="text-foreground">{chunks}</strong>;

  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">{t('heading')}</h1>
          <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Shipping Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">{t('shippingTitle')}</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('deliveryTimesTitle')}</h3>
              <p className="text-muted-foreground mb-3">{t('deliveryTimesP1')}</p>
              <p className="text-muted-foreground">{t.rich('deliveryTimesP2', { strong })}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('trackingTitle')}</h3>
              <p className="text-muted-foreground">{t('trackingBody')}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('multipleTitle')}</h3>
              <p className="text-muted-foreground">{t('multipleBody')}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('internationalTitle')}</h3>
              <p className="text-muted-foreground">{t('internationalBody')}</p>
            </div>
          </div>
        </section>

        {/* Discreet Shipping Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">{t('discreetSectionTitle')}</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('plainPackagingTitle')}</h3>
              <p className="text-muted-foreground">{t.rich('plainPackagingBody', { strong })}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('customsTitle')}</h3>
              <p className="text-muted-foreground">{t('customsBody')}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('billingTitle')}</h3>
              <p className="text-muted-foreground">{t.rich('billingBody', { strong })}</p>
            </div>
          </div>
        </section>

        {/* Cancellations & Returns Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">{t('returnsSectionTitle')}</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('cancelTitle')}</h3>
              <p className="text-muted-foreground">{t('cancelBody')}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('returnPolicyTitle')}</h3>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-3">
                <p className="text-amber-800 dark:text-amber-200 font-medium">
                  {t('returnPolicyCallout')}
                </p>
              </div>
              <p className="text-muted-foreground">{t.rich('returnPolicyBody', { strong })}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">{t('bouncedTitle')}</h3>
              <p className="text-muted-foreground">{t.rich('bouncedBody', { strong })}</p>
            </div>
          </div>
        </section>

        {/* Damaged/Defective Items */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">{t('defectiveSectionTitle')}</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8">
            <p className="text-muted-foreground mb-4">{t('defectiveP1')}</p>
            <p className="text-muted-foreground mb-4">{t('defectiveP2')}</p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
            >
              {t('contactSupport')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </section>

        {/* Questions */}
        <div className="text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-2xl font-semibold text-foreground mb-4">{t('moreQuestionsTitle')}</h2>
          <p className="text-muted-foreground mb-6">{t('moreQuestionsBody')}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/faq"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
            >
              {t('viewFaq')}
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
            >
              {t('contactUs')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
