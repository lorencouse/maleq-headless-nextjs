import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';

/**
 * Sub-layout for localized shell routes (about, contact, cart, etc.).
 *
 * Two responsibilities:
 *   1. Validate the `locale` segment — unknown values 404 instead of rendering.
 *   2. Call setRequestLocale(locale) so pages under this layout can be
 *      statically rendered. Without it, next-intl forces dynamic rendering.
 *
 * The root layout (app/layout.tsx) handles <html lang>, providers, and
 * NextIntlClientProvider — this layout is intentionally lean and just passes
 * children through.
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

  return children;
}
