'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';

/**
 * Syncs <html lang> to the active locale on the client.
 *
 * The root layout renders <html lang> with the DEFAULT locale because it
 * cannot read the request locale without tripping DYNAMIC_SERVER_USAGE on
 * ISR routes (see app/layout.tsx). This component runs inside the
 * locale-aware provider (via StorefrontChrome), so on /es/* routes it
 * corrects the lang attribute to match. Renders nothing.
 */
export default function HtmlLangSync() {
  const locale = useLocale();

  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return null;
}
