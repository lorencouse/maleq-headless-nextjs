import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { Toaster } from "@/components/ui/Toaster";
import NewsletterPopup from "@/components/newsletter/NewsletterPopup";
import { OrganizationSchema, WebSiteSchema } from "@/components/seo/StructuredData";
import GoogleAnalytics from "@/components/analytics/GoogleAnalytics";
import QueryProvider from "@/components/providers/QueryProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-poppins",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
const SITE_NAME = 'Male Q';
const SITE_DESCRIPTION = 'Discover premium adult products at Male Q. Shop our curated collection with fast, discreet shipping and excellent customer service.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
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
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: '/favicon/favicon.ico',
    shortcut: '/favicon/favicon-16x16.png',
    apple: '/favicon/apple-touch-icon.png',
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
      <body className={`${inter.className} ${poppins.variable} antialiased flex flex-col min-h-screen`}>
        <GoogleAnalytics />
        <OrganizationSchema
          name={SITE_NAME}
          url={SITE_URL}
          logo={`${SITE_URL}/logo.png`}
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
              <Toaster />
              <Header />
              <main id="main-content" className="flex-grow" role="main">
                {children}
              </main>
              <Footer />
              <NewsletterPopup delay={45000} showOnExitIntent />
            </CartProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
