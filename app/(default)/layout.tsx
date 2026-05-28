import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import StorefrontChrome from '@/components/layout/StorefrontChrome';

/**
 * Layout for the default-locale routes that live OUTSIDE `[locale]/`:
 * the content roots (product, shop, guides, brand, brands, sex-toys) and
 * admin. These are English-only by design — `proxy.ts` passes them through
 * without the next-intl rewrite, and several are ISR (`revalidate = N`), so
 * reading cookies()/headers() to detect a locale here would throw
 * DYNAMIC_SERVER_USAGE and break the cached pages.
 *
 * Route groups are URL-transparent: `app/(default)/shop/page.tsx` still
 * serves `/shop`. This group exists solely to give these routes a shared
 * <StorefrontChrome> without re-introducing it into the root layout (where
 * it would be pinned to the default locale for ALL routes, including /es/*).
 *
 * setRequestLocale(defaultLocale) is a static literal (never cookies/headers)
 * so the server-rendered Footer resolves its translations to the default
 * locale without poisoning ISR. The NextIntlClientProvider for client chrome
 * (Header/ChatWidget) is inherited from the root layout's default-locale
 * provider.
 */
export default function DefaultLocaleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  setRequestLocale(routing.defaultLocale);

  return <StorefrontChrome>{children}</StorefrontChrome>;
}
