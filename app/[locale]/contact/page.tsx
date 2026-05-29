import Link from 'next/link';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import ContactForm from '@/components/contact/ContactForm';
import ChatWithUsButton from '@/components/chat/ChatWithUsButton';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contactPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: '/contact',
    },
  };
}

export default function ContactPage() {
  const t = useTranslations('contactPage');

  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">{t('heading')}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-12">
          {/* Contact Information */}
          <div className="lg:col-span-1 space-y-8">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-6">{t('getInTouch')}</h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{t('chatTitle')}</h3>
                    <p className="text-muted-foreground mb-3">{t('chatBody')}</p>
                    <ChatWithUsButton />
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{t('textUsTitle')}</h3>
                    <p className="text-muted-foreground">
                      {t('smsLabel')}{' '}
                      <a
                        href="sms:+19785720012"
                        className="text-primary hover:underline"
                        aria-label={t('textUsAriaLabel')}
                      >
                        +1&thinsp;(978)&thinsp;572&#8209;0012
                      </a>
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">{t('smsResponseHint')}</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{t('responseTimeTitle')}</h3>
                    <p className="text-muted-foreground">{t('responseTimeBody')}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* FAQ Link */}
            <div className="bg-muted/30 rounded-xl p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-2">{t('faqTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t('faqBody')}
              </p>
              <Link
                href="/faq"
                className="inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium"
              >
                {t('viewFaq')}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* Shipping Info */}
            <div className="bg-muted/30 rounded-xl p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-2">{t('shippingTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t('shippingBody')}
              </p>
              <Link
                href="/shipping-returns"
                className="inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium"
              >
                {t('shippingLink')}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Contact Form */}
          <div className="lg:col-span-2">
            <div className="bg-card border border-border rounded-xl p-6 md:p-8">
              <h2 className="text-xl font-semibold text-foreground mb-6">{t('formSectionTitle')}</h2>
              <ContactForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
