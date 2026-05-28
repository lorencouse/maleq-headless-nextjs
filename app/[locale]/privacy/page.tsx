import Link from 'next/link';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacyPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/privacy' },
  };
}

export default function PrivacyPolicyPage() {
  const t = useTranslations('privacyPage');

  // Rich-text helpers for inline elements in legal paragraphs
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const link = (chunks: React.ReactNode) => (
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
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('introTitle')}</h2>
              <p className="text-muted-foreground">{t('introP1')}</p>
              <p className="text-muted-foreground mt-4">{t('introP2')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('collectTitle')}</h2>

              <h3 className="text-lg font-medium text-foreground mt-6 mb-3">{t('personalTitle')}</h3>
              <p className="text-muted-foreground">{t('personalIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('personalListCreate')}</li>
                <li>{t('personalListPurchase')}</li>
                <li>{t('personalListNewsletter')}</li>
                <li>{t('personalListSupport')}</li>
                <li>{t('personalListSurvey')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('personalDetails')}</p>

              <h3 className="text-lg font-medium text-foreground mt-6 mb-3">{t('automaticTitle')}</h3>
              <p className="text-muted-foreground">{t('automaticIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('automaticListDevice')}</li>
                <li>{t('automaticListIp')}</li>
                <li>{t('automaticListPages')}</li>
                <li>{t('automaticListReferrer')}</li>
                <li>{t('automaticListLocation')}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('useTitle')}</h2>
              <p className="text-muted-foreground">{t('useIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('useListOrders')}</li>
                <li>{t('useListUpdates')}</li>
                <li>{t('useListSupport')}</li>
                <li>{t('useListMarketing')}</li>
                <li>{t('useListImprove')}</li>
                <li>{t('useListFraud')}</li>
                <li>{t('useListLegal')}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('sharingTitle')}</h2>
              <p className="text-muted-foreground">{t('sharingIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t.rich('sharingListProviders', { strong })}</li>
                <li>{t.rich('sharingListLegal', { strong })}</li>
                <li>{t.rich('sharingListBusiness', { strong })}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('cookiesTitle')}</h2>
              <p className="text-muted-foreground">{t('cookiesIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('cookiesListPrefs')}</li>
                <li>{t('cookiesListAnalytics')}</li>
                <li>{t('cookiesListAds')}</li>
                <li>{t('cookiesListPerf')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('cookiesNote')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('securityTitle')}</h2>
              <p className="text-muted-foreground">{t('securityIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('securityListSsl')}</li>
                <li>{t('securityListPci')}</li>
                <li>{t('securityListAssess')}</li>
                <li>{t('securityListAccess')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t('securityNote')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('rightsTitle')}</h2>
              <p className="text-muted-foreground">{t('rightsIntro')}</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>{t('rightsListAccess')}</li>
                <li>{t('rightsListCorrect')}</li>
                <li>{t('rightsListDelete')}</li>
                <li>{t('rightsListOptOut')}</li>
                <li>{t('rightsListWithdraw')}</li>
              </ul>
              <p className="text-muted-foreground mt-4">{t.rich('rightsExercise', { link })}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('childrenTitle')}</h2>
              <p className="text-muted-foreground">{t('childrenBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('changesTitle')}</h2>
              <p className="text-muted-foreground">{t('changesBody')}</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">{t('contactTitle')}</h2>
              <p className="text-muted-foreground">{t('contactIntro')}</p>
              <ul className="list-none text-muted-foreground mt-2 space-y-1">
                <li>{t.rich('contactFormLabel', { link })}</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
