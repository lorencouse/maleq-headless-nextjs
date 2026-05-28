import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout.meta' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
    alternates: {
      canonical: '/checkout',
    },
  };
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
