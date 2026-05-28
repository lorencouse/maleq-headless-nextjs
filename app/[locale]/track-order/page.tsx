import { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import TrackingForm from '@/components/tracking/TrackingForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'trackOrderPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: '/track-order',
    },
    robots: { index: false },
  };
}

export default function TrackOrderPage() {
  const t = useTranslations('trackOrderPage');

  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            {t('heading')}
          </h1>
          <p className="text-lg text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        <TrackingForm />

        {/* Help Section */}
        <div className="mt-12 text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            {t('helpHeading')}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t('helpBody')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/account/orders"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
            >
              {t('viewAccount')}
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
            >
              {t('contactSupport')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
