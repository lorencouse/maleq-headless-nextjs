import Link from 'next/link';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { buildLocaleAlternates } from '@/i18n/seo-alternates';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'termsPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: buildLocaleAlternates(locale, '/terms'),
  };
}

export default function TermsPage() {
  const t = useTranslations('termsPage');

  // Rich-text helpers for inline elements
  const shippingReturnsLink = (chunks: React.ReactNode) => (
    <Link href="/shipping-returns" className="text-primary hover:underline">{chunks}</Link>
  );
  const contactLink = (chunks: React.ReactNode) => (
    <Link href="/contact" className="text-primary hover:underline">{chunks}</Link>
  );

  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">{t('heading')}</h1>
          <p className="text-muted-foreground">{t('lastUpdated')}</p>
        </div>

        {/* Content */}
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-8">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('agreementTitle')}</h2>
              <p className="text-muted-foreground">{t('agreementBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('ageTitle')}</h2>
              <p className="text-muted-foreground">{t('ageBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('accountTitle')}</h2>
              <p className="text-muted-foreground">{t('accountIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('accountListConfidentiality')}</li>
                <li>{t('accountListActivities')}</li>
                <li>{t('accountListNotify')}</li>
                <li>{t('accountListUpdate')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('accountTerminate')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('productsTitle')}</h2>
              <p className="text-muted-foreground">{t('productsIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('productsListCorrect')}</li>
                <li>{t('productsListChange')}</li>
                <li>{t('productsListLimit')}</li>
                <li>{t('productsListRefuse')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('productsPrices')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('ordersTitle')}</h2>
              <p className="text-muted-foreground">{t('ordersIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('ordersListInfo')}</li>
                <li>{t('ordersListAuth')}</li>
                <li>{t('ordersListPay')}</li>
                <li>{t('ordersListVerify')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('ordersRefuse')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('shippingTitle')}</h2>
              <p className="text-muted-foreground">{t('shippingP1')}</p>
              <p className="text-muted-foreground mt-4">
                {t.rich('shippingP2', { link: shippingReturnsLink })}
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('returnsTitle')}</h2>
              <p className="text-muted-foreground">
                {t.rich('returnsBody', { link: shippingReturnsLink })}
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('ipTitle')}</h2>
              <p className="text-muted-foreground">{t('ipP1')}</p>
              <p className="text-muted-foreground mt-4">{t('ipP2')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('prohibitedTitle')}</h2>
              <p className="text-muted-foreground">{t('prohibitedIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('prohibitedListUnlawful')}</li>
                <li>{t('prohibitedListAccess')}</li>
                <li>{t('prohibitedListInterfere')}</li>
                <li>{t('prohibitedListAutomated')}</li>
                <li>{t('prohibitedListImpersonate')}</li>
                <li>{t('prohibitedListFraud')}</li>
                <li>{t('prohibitedListResell')}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('warrantyTitle')}</h2>
              <p className="text-muted-foreground">{t('warrantyP1')}</p>
              <p className="text-muted-foreground mt-4">{t('warrantyP2')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('liabilityTitle')}</h2>
              <p className="text-muted-foreground">{t('liabilityP1')}</p>
              <p className="text-muted-foreground mt-4">{t('liabilityP2')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('indemnTitle')}</h2>
              <p className="text-muted-foreground">{t('indemnBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('lawTitle')}</h2>
              <p className="text-muted-foreground">{t('lawBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('changesTitle')}</h2>
              <p className="text-muted-foreground">{t('changesBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('contactTitle')}</h2>
              <p className="text-muted-foreground">{t('contactIntro')}</p>
              <ul className="list-none text-muted-foreground mt-2 space-y-1">
                <li>{t.rich('contactFormLabel', { link: contactLink })}</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
