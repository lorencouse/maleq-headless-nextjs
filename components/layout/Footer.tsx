import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import NewsletterSignup from '@/components/newsletter/NewsletterSignup';

export default function Footer() {
  const t = useTranslations('footer');
  const currentYear = new Date().getFullYear();

  return (
    <footer className='bg-card border-t border-border text-muted-foreground transition-colors' role="contentinfo" aria-label={t('siteFooter')}>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-8'>
          {/* About */}
          <div>
            <h3 className='text-foreground text-lg font-semibold mb-4'>
              Male Q
            </h3>
            <p className='text-sm'>
              {t('tagline')}
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className='text-foreground text-sm font-semibold mb-4'>
              {t('quickLinks')}
            </h4>
            <ul className='space-y-1'>
              <li>
                <Link
                  href='/shop'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('shop')}
                </Link>
              </li>
              <li>
                <Link
                  href='/guides'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('guides')}
                </Link>
              </li>
              <li>
                <Link
                  href='/about'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('aboutUs')}
                </Link>
              </li>
              <li>
                <Link
                  href='/contact'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h4 className='text-foreground text-sm font-semibold mb-4'>
              {t('customerService')}
            </h4>
            <ul className='space-y-1'>
              <li>
                <Link
                  href='/track-order'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('orderTracking')}
                </Link>
              </li>
              <li>
                <Link
                  href='/shipping-returns'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('returns')}
                </Link>
              </li>
              <li>
                <Link
                  href='/faq'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('faq')}
                </Link>
              </li>
              <li>
                <Link
                  href='/privacy'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  {t('privacyPolicy')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <NewsletterSignup
              source="footer"
              variant="inline"
              showTitle
              showDescription
              title={t('newsletterTitle')}
              description={t('newsletterDescription')}
            />
          </div>
        </div>

        {/* Bottom Bar */}
        <div className='flex justify-center items-center gap-3 border-t border-border mt-8 pt-8 text-sm text-center'>
          <Image
            src='/images/MQ-logo.png'
            alt='Male Q'
            width={40}
            height={40}
            className='inline-block'
          />
          <p>{t('copyright', { year: currentYear })}</p>
        </div>
      </div>
    </footer>
  );
}
