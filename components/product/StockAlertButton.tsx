'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  isSubscribedToAlert,
  addStockAlert,
  removeStockAlert,
  getAlertEmail,
} from '@/lib/utils/stock-alerts';
import { isValidEmail } from '@/lib/api/validation';
import { showSuccess, showError } from '@/lib/utils/toast';
import { PUSH_OWNERSHIP_TOKEN_KEY, usePushSubscription } from '@/lib/hooks/usePushSubscription';

interface StockAlertButtonProps {
  productId: string;
  productName: string;
  productSlug?: string;
  variant?: 'button' | 'inline';
  className?: string;
}

export default function StockAlertButton({
  productId,
  productName,
  productSlug = '',
  variant = 'button',
  className = '',
}: StockAlertButtonProps) {
  const t = useTranslations('stockAlert');
  const [isAlertSet, setIsAlertSet] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const {
    isSupported: pushSupported,
    isSubscribed: pushSubscribed,
    endpoint,
    ownershipToken,
    subscribe: pushSubscribe,
  } = usePushSubscription();

  useEffect(() => {
    const subscribed = isSubscribedToAlert(productId);
    setIsAlertSet(subscribed);
    if (subscribed) {
      const savedEmail = getAlertEmail(productId);
      if (savedEmail) setEmail(savedEmail);
    }
  }, [productId]);

  // ── Push-based stock alert ──────────────────────────────────────────
  const handlePushAlert = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let currentEndpoint = endpoint;
      let currentOwnershipToken = ownershipToken;

      // If not push-subscribed yet, opt in first
      if (!pushSubscribed) {
        const ok = await pushSubscribe();
        if (!ok) {
          // Push permission denied — fall back to email form
          setShowForm(true);
          setIsLoading(false);
          return;
        }
        // After subscribing, read the new endpoint from localStorage
        currentEndpoint = localStorage.getItem('maleq-push-endpoint');
        currentOwnershipToken = localStorage.getItem(PUSH_OWNERSHIP_TOKEN_KEY);
      }

      if (!currentEndpoint || !currentOwnershipToken) {
        setShowForm(true);
        setIsLoading(false);
        return;
      }

      const res = await fetch('/api/push/stock-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: currentEndpoint,
          ownershipToken: currentOwnershipToken,
          productId: Number(productId),
          productName,
          productSlug,
        }),
      });

      const result = await res.json();
      if (result.success) {
        addStockAlert({ productId, productName, email: 'push' });
        setIsAlertSet(true);
        setShowForm(false);
        showSuccess(t('toastPushSubscribed'));
      } else {
        showError(result.error || t('toastSubscribeFailed'));
      }
    } catch {
      showError(t('toastSubscribeRetry'));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Email-based stock alert (fallback) ──────────────────────────────
  const handleEmailAlert = async () => {
    if (!email.trim()) {
      setError(t('errorEnterEmail'));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t('errorInvalidEmail'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/stock-alerts/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, productName, productSlug, email: email.trim() }),
      });

      const result = await response.json();
      if (result.success) {
        addStockAlert({ productId, productName, email: email.trim() });
        setIsAlertSet(true);
        setShowForm(false);
        showSuccess(result.message);
      } else {
        const message = result.error || t('toastEmailFailed');
        setError(message);
        showError(message);
      }
    } catch {
      setError(t('toastEmailFailed'));
      showError(t('toastEmailFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setIsLoading(true);

    try {
      // Remove push stock alert if applicable
      if (pushSubscribed && endpoint) {
        let tokenForDelete = ownershipToken;
        if (!tokenForDelete) {
          tokenForDelete = localStorage.getItem(PUSH_OWNERSHIP_TOKEN_KEY);
        }
        if (tokenForDelete) {
          await fetch('/api/push/stock-alert', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint,
              ownershipToken: tokenForDelete,
              productId: Number(productId),
            }),
          });
        }
      }

      // Also remove email-based alert
      if (email && email !== 'push') {
        await fetch(
          `/api/stock-alerts/subscribe?productId=${productId}&email=${encodeURIComponent(email)}`,
          { method: 'DELETE' }
        );
      }

      removeStockAlert(productId);
      setIsAlertSet(false);
      setEmail('');
      showSuccess(t('toastRemoved'));
    } catch {
      showError(t('toastRemoveFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotifyClick = () => {
    if (pushSupported) {
      handlePushAlert();
    } else {
      setShowForm(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEmailAlert();
    }
    if (e.key === 'Escape') {
      setShowForm(false);
      setError(null);
    }
  };

  // ── Subscribed state ────────────────────────────────────────────────
  if (isAlertSet) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-2 p-3 bg-info/10 rounded-lg">
          <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-info">
              {t('alertSetHeading')}
            </p>
            <p className="text-xs text-info/80">
              {email === 'push'
                ? t('alertSetPushDetail')
                : t('alertSetEmailDetail', { email })}
            </p>
          </div>
          <button
            onClick={handleUnsubscribe}
            disabled={isLoading}
            className="px-3 py-2 min-h-[44px] text-sm text-info hover:text-info-hover hover:bg-info/10 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? '...' : t('remove')}
          </button>
        </div>
      </div>
    );
  }

  // ── Button variant ──────────────────────────────────────────────────
  if (variant === 'button') {
    if (!showForm) {
      return (
        <button
          onClick={handleNotifyClick}
          disabled={isLoading}
          className={`w-full py-3 px-6 border-2 border-info text-info rounded-lg hover:bg-info/10 transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${className}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {isLoading ? t('settingUp') : t('notifyMeWhenAvailable')}
        </button>
      );
    }

    // Email fallback form
    return (
      <div className={`p-4 border border-border rounded-lg bg-muted/30 ${className}`}>
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="font-medium text-foreground">{t('getStockAlertHeading')}</span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          {t('enterEmailPrompt')}
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('placeholderYourEmail')}
            disabled={isLoading}
            className="flex-1 px-3 py-2.5 min-h-[44px] text-sm border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={handleEmailAlert}
            disabled={isLoading || !email.trim()}
            className="px-4 py-2.5 min-h-[44px] bg-info text-info-foreground text-sm font-medium rounded-lg hover:bg-info-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '...' : t('notify')}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        )}
        <button
          onClick={() => {
            setShowForm(false);
            setError(null);
          }}
          className="mt-2 px-3 py-2 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          {t('cancel')}
        </button>
      </div>
    );
  }

  // ── Inline variant ──────────────────────────────────────────────────
  return (
    <div className={`flex gap-2 ${className}`}>
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('placeholderInlineEmail')}
        disabled={isLoading}
        className="flex-1 px-3 py-2.5 min-h-[44px] text-sm border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      />
      <button
        onClick={handleEmailAlert}
        disabled={isLoading || !email.trim()}
        className="px-4 py-2.5 min-h-[44px] bg-info text-info-foreground text-sm font-medium rounded-lg hover:bg-info-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {isLoading ? '...' : t('notifyMe')}
      </button>
    </div>
  );
}
