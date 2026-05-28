import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import StorefrontChrome from '@/components/layout/StorefrontChrome';
import { getGuideLocaleBySlug } from '@/lib/db/guide-locale';
import { staticRequestLocale } from '@/lib/i18n/guide-languages';
import { staticIntlProviderProps } from '@/i18n/static-intl-props';
// Statically import the catalogs (like the root layout) instead of calling
// getMessages() — getMessages() resolves the request config dynamically, which
// trips DYNAMIC_SERVER_USAGE on these ISR guide routes (500). Static imports
// are build-time, so the nested provider stays ISR-safe.
import enMessages from '@/messages/en.json';
import esMessages from '@/messages/es.json';
import zhMessages from '@/messages/zh.json';
import jaMessages from '@/messages/ja.json';

const CATALOGS: Record<string, Record<string, unknown>> = {
  en: enMessages,
  es: esMessages,
  zh: zhMessages,
  ja: jaMessages,
};

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

  // CRITICAL for ISR: setRequestLocale() opts this page into STATIC rendering.
  // Without it next-intl resolves the locale via headers() → DYNAMIC_SERVER_USAGE
  // → every guide post 500s under `revalidate = N`. It must be a value next-intl
  // accepts (a routing locale), so the chrome-only locales zh/ja seed with the
  // default (en). The ACTUAL guide language flows through the statically-imported
  // catalog + provider below and the page's explicit getTranslations/locale props
  // (the client chrome — Footer/Header — reads the provider, so it renders in the
  // real locale regardless).
  setRequestLocale(staticRequestLocale(locale));
  const messages = CATALOGS[locale] ?? CATALOGS.en;

  return (
    // timeZone/now/formats passed explicitly so this nested server provider
    // never inherits them via getConfig()→headers() (DYNAMIC_SERVER_USAGE on
    // this ISR route). See i18n/static-intl-props.ts.
    <NextIntlClientProvider locale={locale} messages={messages} {...staticIntlProviderProps()}>
      <StorefrontChrome>{children}</StorefrontChrome>
    </NextIntlClientProvider>
  );
}
