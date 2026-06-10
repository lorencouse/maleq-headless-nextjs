import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { routing } from "@/i18n/routing";
import { staticIntlProviderProps } from "@/i18n/static-intl-props";
// Import the default-locale messages statically so the root layout never has to
// call getMessages() (which would prime next-intl's getConfig(undefined) cache
// with English and starve [locale]/layout of the slot it needs to load Spanish).
import defaultMessages from "@/messages/en.json";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { Toaster } from "@/components/ui/Toaster";
import { OrganizationSchema, WebSiteSchema } from "@/components/seo/StructuredData";
import GoogleAnalytics from "@/components/analytics/GoogleAnalytics";
import WebVitals from "@/components/analytics/WebVitals";
import QueryProvider from "@/components/providers/QueryProvider";
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration";
import ChunkErrorReload from "@/components/pwa/ChunkErrorReload";
import OfflineIndicator from "@/components/pwa/OfflineIndicator";
import AppBadge from "@/components/pwa/AppBadge";
import RouteScrollManager from "@/components/navigation/RouteScrollManager";
import PwaAnalytics from "@/components/pwa/PwaAnalytics";
import BackgroundSyncReplay from "@/components/pwa/BackgroundSyncReplay";
import CartStockRevalidation from "@/components/pwa/CartStockRevalidation";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const SITE_NAME = 'Male Q';
const SITE_DESCRIPTION = 'Discover premium adult products at Male Q. Shop our curated collection with fast, discreet shipping and excellent customer service.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} - Premium Adult Products`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: ['adult products', 'adult store', 'intimate products', 'discreet shipping'],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} - Premium Adult Products`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} - Premium Adult Products`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} - Premium Adult Products`,
    description: SITE_DESCRIPTION,
    images: ['/og-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    // Add verification tokens when available
    // google: 'verification_token',
    // yandex: 'verification_token',
    // bing: 'verification_token',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Male Q',
  },
  icons: {
    icon: [
      { url: '/favicon/favicon.ico', sizes: 'any' },
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/android/android-launchericon-192-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon/android/android-launchericon-512-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon/favicon-32x32.png',
    apple: [
      { url: '/favicon/apple-touch-icon.png', sizes: '180x180' },
      { url: '/favicon/ios/152.png', sizes: '152x152' },
      { url: '/favicon/ios/120.png', sizes: '120x120' },
    ],
  },
  manifest: '/favicon/site.webmanifest',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Hard-code the default locale at the root and seed next-intl's request
  // DYNAMIC_SERVER_USAGE on any ISR page outside [locale]/.
  //
  // The STOREFRONT CHROME (Header/Footer/ChatWidget/Newsletter) is NOT
  // rendered here. It lives in the two locale-knowing sub-layouts instead:
  //   - app/[locale]/layout.tsx renders <StorefrontChrome> inside its NESTED
  //     locale-aware NextIntlClientProvider, so /es/* chrome is Spanish.
  //   - app/(default)/layout.tsx renders <StorefrontChrome> for the
  //     default-locale content-root + admin routes (product, shop, guides,
  //     brand(s), sex-toys), which are English-only by design.
  // This root layout keeps only the locale-INDEPENDENT global shell
  // (providers, analytics, service worker, toaster, schema) so it is shared
  // by every route and the chrome is never double-rendered.
  //
  // CRITICAL: we must NOT call setRequestLocale() here. next-intl memoizes
  // its request config per-request; the FIRST server-side useTranslations/
  // getTranslations call resolves getConfig() against whatever locale is
  // cached at that moment, and that result is reused for the WHOLE request.
  // If the root pinned 'en' via setRequestLocale, every server component in
  // the /es/* subtree (Footer, page bodies) would resolve to English even
  // though the client provider has Spanish messages. Instead each leaf tree
  // sets its own locale: [locale]/layout calls setRequestLocale(locale) and
  // (default)/layout calls setRequestLocale(defaultLocale) — both static
  // literals, so ISR stays safe. Routes that render directly in this root
  // layout (not-found / error) have no setRequestLocale; request.ts falls
  // back to the default locale for them without reading cookies/headers.
  //
  // The static `defaultMessages` import (not getMessages()) feeds this root's
  // fallback client provider without touching the getConfig() cache.
  const locale = routing.defaultLocale;
  const messages = defaultMessages;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${dmSans.variable} ${outfit.variable} antialiased flex flex-col min-h-screen`}>
        {/* Mastodon profile verification: an invisible rel="me" backlink to
            @mqnews@mastodon.social. React hoists this <link> into <head>; the
            Mastodon custom-field verifier follows the site URL and looks for a
            rel="me" link pointing back to the profile. No visible UI. */}
        <link rel="me" href="https://mastodon.social/@mqnews" />
        <ChunkErrorReload />
        <ServiceWorkerRegistration />
        <RouteScrollManager />
        <OfflineIndicator />
        <GoogleAnalytics />
        <WebVitals />
        <PwaAnalytics />
        <BackgroundSyncReplay />
        <OrganizationSchema
          name={SITE_NAME}
          url={SITE_URL}
          logo={`${SITE_URL}/favicon/android/android-launchericon-512-512.png`}
          contactPoint={{
            url: `${SITE_URL}/contact`,
            contactType: 'customer service',
          }}
        />
        <WebSiteSchema
          name={SITE_NAME}
          url={SITE_URL}
          searchUrl={`${SITE_URL}/search?q={search_term_string}`}
        />
        {/* timeZone/now/formats passed explicitly so this server provider never
            inherits them via getConfig()→headers() — which would 500 the ISR
            content-root routes (/guides, /shop, …). See i18n/static-intl-props.ts. */}
        <NextIntlClientProvider locale={locale} messages={messages} {...staticIntlProviderProps()}>
          <QueryProvider>
            <ThemeProvider>
              <CartProvider>
                <AppBadge />
                <CartStockRevalidation />
                <Toaster />
                {children}
              </CartProvider>
            </ThemeProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
