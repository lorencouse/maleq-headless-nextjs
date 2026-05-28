import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { Toaster } from "@/components/ui/Toaster";
import NewsletterPopup from "@/components/newsletter/NewsletterPopup";
import { OrganizationSchema, WebSiteSchema } from "@/components/seo/StructuredData";
import GoogleAnalytics from "@/components/analytics/GoogleAnalytics";
import WebVitals from "@/components/analytics/WebVitals";
import QueryProvider from "@/components/providers/QueryProvider";
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration";
import OfflineIndicator from "@/components/pwa/OfflineIndicator";
import PushNotificationPrompt from "@/components/pwa/PushNotificationPrompt";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import AppBadge from "@/components/pwa/AppBadge";
import RouteScrollManager from "@/components/navigation/RouteScrollManager";
import PwaAnalytics from "@/components/pwa/PwaAnalytics";
import BackgroundSyncReplay from "@/components/pwa/BackgroundSyncReplay";
import CartStockRevalidation from "@/components/pwa/CartStockRevalidation";
import ChatWidget from "@/components/chat/ChatWidget";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${outfit.variable} antialiased flex flex-col min-h-screen`}>
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
        <QueryProvider>
          <ThemeProvider>
            <CartProvider>
              <AppBadge />
              <CartStockRevalidation />
              <Toaster />
              <Header />
              <main id="main-content" className="flex-grow" role="main">
                {children}
              </main>
              <Footer />
              <NewsletterPopup delay={45000} showOnExitIntent />
              <div className="fixed bottom-4 right-4 z-40 max-w-sm space-y-3">
                <InstallPrompt minVisits={2} />
                <PushNotificationPrompt minVisits={3} />
              </div>
              <ChatWidget />
            </CartProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
