'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';

// Map the internal locale to a proper BCP-47 language tag. The bare `zh`
// routing locale is Simplified (zh-Hans); `zh-hant` is Traditional (Taiwan),
// so search engines treat them as distinct languages.
const BCP47: Record<string, string> = {
  en: 'en',
  es: 'es',
  de: 'de',
  fr: 'fr',
  zh: 'zh-Hans',
  'zh-hant': 'zh-Hant',
  ja: 'ja',
};

/**
 * Syncs <html lang> to the active locale on the client.
 *
 * The root layout renders <html lang> with the DEFAULT locale because it
 * cannot read the request locale without tripping DYNAMIC_SERVER_USAGE on
 * ISR routes (see app/layout.tsx). This component runs inside the
 * locale-aware provider (via StorefrontChrome), so on /es/* routes and the
 * per-language guides it corrects the lang attribute to the right BCP-47 tag.
 * Note: this is a client-side correction; the authoritative language signals
 * for crawlers are the server-rendered hreflang alternates + page content +
 * localized <title>/meta (see the guide's generateMetadata). Renders nothing.
 */
export default function HtmlLangSync() {
  const locale = useLocale();
  const lang = BCP47[locale] ?? locale;

  useEffect(() => {
    if (document.documentElement.lang !== lang) {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  return null;
}
