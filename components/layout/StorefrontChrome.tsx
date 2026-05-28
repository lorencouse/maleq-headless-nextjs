import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import HtmlLangSync from '@/components/layout/HtmlLangSync';
import ChromeLocaleProvider from '@/components/i18n/ChromeLocaleProvider';
import NewsletterPopup from '@/components/newsletter/NewsletterPopup';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import PushNotificationPrompt from '@/components/pwa/PushNotificationPrompt';
import ChatWidget from '@/components/chat/ChatWidget';

/**
 * The locale-aware storefront chrome: Header, Footer, and the floating
 * widgets (newsletter popup, PWA prompts, support chat).
 *
 * This is a server component so it can render the server-side Footer
 * (getTranslations) alongside the client-side Header/ChatWidget. It is
 * rendered by the layouts that KNOW their locale — `app/[locale]/layout.tsx`
 * (inside its locale-aware NextIntlClientProvider) and
 * `app/(default)/layout.tsx` (default-locale content-root + admin routes) —
 * NOT by the root layout. Keeping it out of the root is what lets `/es/*`
 * chrome render in Spanish (the root provider is pinned to the default
 * locale for ISR safety). See app/layout.tsx for the full rationale.
 *
 * Locale-independent global UI (analytics, service worker, toaster, cart
 * revalidation, schema) stays in the root layout so it is shared by every
 * route and never double-rendered.
 *
 * <ChromeLocaleProvider> wraps everything so the language toggle can switch
 * the CLIENT chrome (Header/Footer/ChatWidget/menus) to the user's chosen UI
 * language via a cookie — but only on default-locale (en) pages; it leaves
 * /es/* URL routes and the per-language guides untouched. See that component.
 */
export default function StorefrontChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChromeLocaleProvider>
      <HtmlLangSync />
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
    </ChromeLocaleProvider>
  );
}
