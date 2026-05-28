import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import RegisterForm from '@/components/auth/RegisterForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
    alternates: {
      canonical: '/register',
    },
  };
}

export default function RegisterPage() {
  const t = useTranslations('auth');

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-bold text-primary">Male Q</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-foreground">{t('register.heading')}</h1>
          <p className="mt-2 text-muted-foreground">
            {t('register.subheading')}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <Suspense fallback={<div className="h-64 flex items-center justify-center text-muted-foreground">{t('common.loading')}</div>}>
            <RegisterForm />
          </Suspense>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t('register.termsBefore')}{' '}
          <Link href="/terms" className="text-primary hover:text-primary-hover">
            {t('common.termsOfService')}
          </Link>{' '}
          {t('common.termsAnd')}{' '}
          <Link href="/privacy" className="text-primary hover:text-primary-hover">
            {t('common.privacyPolicy')}
          </Link>
        </p>
      </div>
    </div>
  );
}
