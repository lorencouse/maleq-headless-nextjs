import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation wrappers.
 *
 * Use these instead of next/navigation's Link/useRouter/usePathname when you
 * need locale-aware behavior:
 *   - <Link href="/about"> automatically prefixes the current locale
 *   - useRouter().replace('/about', { locale: 'es' }) navigates to /es/about
 *   - usePathname() returns the path WITHOUT the locale prefix
 *
 * Components that don't need locale awareness (links to product pages, etc.)
 * can keep using next/navigation directly — product/sex-toys/brand/shop/guides
 * routes are NOT under [locale] anyway.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
