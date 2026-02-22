'use client';

import { useState, useEffect } from 'react';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import { showSuccess, showError } from '@/lib/utils/toast';

interface PushNotificationPromptProps {
  /** Show only after this many visits (0 = always show) */
  minVisits?: number;
  /** Optional customer ID to associate with the subscription */
  customerId?: number;
  /** Optional email to associate with the subscription */
  email?: string;
  className?: string;
}

const DISMISS_KEY = 'maleq-push-prompt-dismissed';
const VISITS_KEY = 'maleq-visit-count';

export default function PushNotificationPrompt({
  minVisits = 0,
  customerId,
  email,
  className = '',
}: PushNotificationPromptProps) {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePushSubscription();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if not supported, already subscribed, or permission denied
    if (!isSupported || isSubscribed || permission === 'denied') return;

    // Don't show if dismissed
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      return;
    }

    // Check visit count
    if (minVisits > 0) {
      try {
        const visits = parseInt(localStorage.getItem(VISITS_KEY) || '0', 10) + 1;
        localStorage.setItem(VISITS_KEY, String(visits));
        if (visits < minVisits) return;
      } catch {
        // localStorage unavailable — show prompt anyway
      }
    }

    setVisible(true);
  }, [isSupported, isSubscribed, permission, minVisits]);

  if (!visible) return null;

  const handleEnable = async () => {
    const success = await subscribe(customerId, email);
    if (success) {
      setVisible(false);
      showSuccess('Notifications enabled! You\'ll receive updates about your orders and deals.');
    } else if (Notification.permission === 'denied') {
      setVisible(false);
      showError('Notifications blocked. You can enable them in your browser settings.');
    } else {
      showError('Could not enable notifications. Please try again.');
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  return (
    <div className={`bg-card border border-border rounded-xl p-5 ${className}`}>
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground mb-1">Stay Updated</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Get notified about order updates, back-in-stock products, and exclusive deals.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleEnable}
              disabled={isLoading}
              className="px-4 py-2.5 min-h-[44px] bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Enabling...' : 'Enable Notifications'}
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
