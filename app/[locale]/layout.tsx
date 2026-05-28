import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import StorefrontChrome from '@/components/layout/StorefrontChrome';

/**
 * Sub-layout for localized shell routes (about, contact, cart, etc.).
 *
 * Responsibilities:
 *   1. Validate the `locale` segment — unknown values 404 instead of rendering.
 *   2. Call setRequestLocale(locale) so pages (and the server-rendered Footer)
 *      under this layout statically render in the URL locale, overriding the
 *      root layout's default-locale cache seed.
 *   3. Wrap {children} in a NESTED NextIntlClientProvider so the page tree
 *      AND the storefront chrome see the URL locale.
 *   4. Render <StorefrontChrome> here (inside that nested provider) rather
 *      than in the root layout — this is what makes Header/Footer/ChatWidget/
 *      Newsletter render in Spanish on /es/* routes. The root layout stays
 *      locale-independent so it can be shared with the default-locale
 *      content-root routes without forcing English chrome onto /es/*.
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StorefrontChrome>{children}</StorefrontChrome>
    </NextIntlClientProvider>
  );
}
