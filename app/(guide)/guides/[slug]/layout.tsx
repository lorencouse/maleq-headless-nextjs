import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import StorefrontChrome from '@/components/layout/StorefrontChrome';
import { getGuideLocaleBySlug } from '@/lib/db/guide-locale';

/**
 * Layout for an individual guide post (`/guides/{slug}`).
 *
 * Unlike the rest of the content roots — which live in app/(default)/ and
 * render English chrome — a guide renders its shell in the POST'S OWN
 * language. The post's language is its top-level category (en/es/zh/ja); we
 * resolve it from the slug and render <StorefrontChrome> inside a matching
 * NextIntlClientProvider, plus setRequestLocale() so the server-rendered
 * Footer and the page body resolve to the same locale. So a Spanish guide
 * shows a Spanish header/footer, a Chinese guide a Chinese one, etc.
 *
 * This is page-scoped by design: it does NOT set a locale cookie, so browsing
 * away to the (English-only, ISR) product/shop pages stays English. The locale
 * is derived purely from the URL slug, so the page stays ISR-safe (no cookies
 * or headers — those would throw DYNAMIC_SERVER_USAGE on a revalidated page).
 *
 * This route lives in its own (guide) route group so its chrome is NOT
 * double-rendered by app/(default)/layout.tsx. The guides index/category/tag
 * listings stay under (default) and render in English (they mix languages).
 */
export default async function GuidePostLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getGuideLocaleBySlug(slug);

  // NOTE: deliberately NOT calling setRequestLocale(locale). On these
  // content-root routes it's a no-op for getLocale() (no next-intl middleware),
  // AND it THROWS for zh/ja because those aren't routing.locales. We pass the
  // locale explicitly to getMessages() and the provider instead.
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <StorefrontChrome>{children}</StorefrontChrome>
    </NextIntlClientProvider>
  );
}
