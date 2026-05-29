'use client';

import { useTranslations } from 'next-intl';

/**
 * Renders a single translated string from a message catalog, client-side.
 *
 * Use this for text that lives in a SERVER component on an English-pinned
 * content-root route (product/shop/guide pages), where getTranslations() can
 * only ever resolve `en`. Rendering the text through this client component
 * lets ChromeLocaleProvider re-localize it in place when the user switches
 * language — same mechanism as the rest of the client chrome. Crawlers (no
 * cookie) still see the English SSR output, so there's no SEO effect.
 */
export default function LocalizedText({
  ns,
  k,
}: {
  /** Message namespace, e.g. "productSlugPage". */
  ns: string;
  /** Key within the namespace, e.g. "descriptionHeading". */
  k: string;
}) {
  const t = useTranslations(ns);
  return <>{t(k)}</>;
}
