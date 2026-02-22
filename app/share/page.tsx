import { redirect } from 'next/navigation';

/**
 * Web Share Target handler.
 *
 * When the PWA is installed and a user shares a URL/text to it,
 * this page receives the shared data via query params and routes
 * to the appropriate destination.
 */

interface SharePageProps {
  searchParams: Promise<{ title?: string; text?: string; url?: string }>;
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const sharedUrl = params.url || '';
  const sharedText = params.text || '';

  // If a URL from our own site was shared, redirect directly to it
  const siteHost = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';
  if (sharedUrl.startsWith(siteHost) || sharedUrl.startsWith('/')) {
    const path = sharedUrl.startsWith(siteHost)
      ? sharedUrl.slice(siteHost.length)
      : sharedUrl;
    redirect(path || '/');
  }

  // Extract a search term from the shared content
  const searchTerm = params.title || sharedText || sharedUrl;
  if (searchTerm) {
    redirect(`/shop?q=${encodeURIComponent(searchTerm)}`);
  }

  redirect('/');
}
