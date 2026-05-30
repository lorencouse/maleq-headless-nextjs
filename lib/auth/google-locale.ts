// App locale → Google Identity Services (GSI) display locale. GSI ships its own
// translations for the Sign-in button label; we just tell it which one to use.
// Google uses underscore-separated variants for Chinese (`zh_CN` Simplified,
// `zh_TW` Traditional), matching our `zh` / `zh-hant` content. Other locales map
// 1:1 to their two-letter code.
//
// Browser-safe (no server imports) so it can be used from the client button.
const GOOGLE_LOCALE: Record<string, string> = {
  en: 'en',
  es: 'es',
  de: 'de',
  fr: 'fr',
  ja: 'ja',
  zh: 'zh_CN',
  'zh-hant': 'zh_TW',
};

/**
 * Map an app locale to a GSI button locale so the "Sign in with Google" button
 * renders in the user's language. Unknown locales return `undefined`, which lets
 * GSI fall back to the user's Google account / browser language.
 */
export function getGoogleLocale(locale: string): string | undefined {
  return GOOGLE_LOCALE[locale];
}
