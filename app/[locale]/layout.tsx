import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';

/**
 * Sub-layout for localized shell routes (about, contact, cart, etc.).
 *
 * Responsibilities:
 *   1. Validate the `locale` segment — unknown values 404 instead of rendering.
 *   2. Call setRequestLocale(locale) so pages under this layout statically
 *      render in the URL locale (overriding the root layout's default-locale
 *      cache seed).
 *   3. Wrap {children} in a NESTED NextIntlClientProvider so the page tree
 *      sees the URL locale. The root layout's outer provider (locked to
 *      the default locale) keeps rendering Header/Footer in English — a
 *      known regression on /es/ chrome that's deferred to Phase 8.
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
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
