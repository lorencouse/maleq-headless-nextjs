/**
 * Props that make a SERVER-rendered <NextIntlClientProvider> fully
 * self-contained, so it can be used on statically-generated / ISR routes.
 *
 * WHY THIS EXISTS (the guide-pages 500 incident):
 * When a Server Component renders <NextIntlClientProvider> without passing
 * `timeZone`, `now`, and `formats`, next-intl's server wrapper
 * (NextIntlClientProviderServer) inherits each of them by calling getConfig()
 * with NO locale override. getConfig() then resolves the request locale via
 *   getRequestLocale() → getCachedRequestLocale() || headers()
 * and on an ISR route (`revalidate = N`) that has no next-intl middleware to
 * set the locale header — i.e. the content roots /guides, /shop, /sex-toys,
 * /brand(s) that proxy.ts passes through untouched — reading headers() throws
 * `DYNAMIC_SERVER_USAGE`, which 500s the page. setRequestLocale() is supposed
 * to seed getCachedRequestLocale() and avoid the headers() read, but the ROOT
 * layout's provider renders before (and outside) those content-root layouts
 * and deliberately never calls setRequestLocale (doing so would poison the
 * per-request config cache for /es). So the seed isn't reliably present when
 * the root provider resolves — and the page 500s.
 *
 * Passing these three props explicitly short-circuits the inheritance: the
 * provider never calls getConfig()/getRequestLocale()/headers() at all (the
 * caller already passes `locale` and `messages` too, so all five
 * getConfig-backed lookups are bypassed). The page stays statically
 * renderable regardless of where setRequestLocale ran.
 *
 * Values preserve existing behaviour:
 *   - `timeZone` matches next-intl's own default (the runtime resolved zone),
 *     so date/number formatting is unchanged.
 *   - `now` is inert here: no component uses relative-time formatting, so the
 *     baked timestamp is never read for display (it only seeds IntlProvider).
 *   - `formats` stays empty — i18n/request.ts configures no custom formats.
 */
export function staticIntlProviderProps() {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: new Date(),
    formats: {},
  };
}
