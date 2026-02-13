/**
 * Newsletter Subscription Utility
 *
 * Handles newsletter subscription storage and management
 * In production, integrate with email service providers like Mailchimp, Klaviyo, etc.
 */

const STORAGE_KEY = 'maleq-newsletter-subscribed';
const POPUP_DISMISSED_KEY = 'maleq-newsletter-popup-dismissed';

export interface NewsletterSubscription {
  email: string;
  subscribedAt: string;
  source: 'footer' | 'popup' | 'checkout' | 'page';
}

/**
 * Check if current user is already subscribed (client-side only)
 */
export function isSubscribed(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark current user as subscribed
 */
export function markAsSubscribed(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if newsletter popup has been dismissed
 */
export function isPopupDismissed(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const dismissed = localStorage.getItem(POPUP_DISMISSED_KEY);
    if (!dismissed) return false;

    // Check if dismissed within the last 7 days
    const dismissedAt = parseInt(dismissed, 10);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return dismissedAt > sevenDaysAgo;
  } catch {
    return false;
  }
}

/**
 * Mark popup as dismissed
 */
export function dismissPopup(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(POPUP_DISMISSED_KEY, Date.now().toString());
  } catch {
    // Ignore storage errors
  }
}
