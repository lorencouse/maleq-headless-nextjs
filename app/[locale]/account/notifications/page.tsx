'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import AccountLayout from '@/components/account/AccountLayout';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import { useAuthStore } from '@/lib/store/auth-store';
import {
  clearNotifications,
  getNotifications,
  markAllAsRead,
  markAsRead,
  onNotificationsUpdated,
  STORAGE_KEY as NOTIFICATIONS_STORAGE_KEY,
  type StoredNotification,
} from '@/lib/pwa/notification-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import Button from '@/components/ui/Button';

type PreferenceKey = 'orderUpdates' | 'backInStock' | 'promotions' | 'news';

interface ServerNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  url: string | null;
  sentAt: string;
}

function normalizeNotificationUrl(url: string): string {
  if (!url) return '/';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch {
      return '/';
    }
  }
  return url.startsWith('/') ? url : `/${url}`;
}

// Returns a category translation key + tailwind className for the given
// notification type. The key resolves at render time via useTranslations so
// the label tracks the active locale.
type CategoryKey =
  | 'categoryOrderUpdate'
  | 'categoryBackInStock'
  | 'categorySalesAndDeals'
  | 'categoryReminder'
  | 'categoryGeneral';

function getNotificationCategory(type: string): { key: CategoryKey; className: string } {
  const normalized = type.toLowerCase();

  if (normalized.includes('order') || normalized.includes('tracking')) {
    return {
      key: 'categoryOrderUpdate',
      className: 'bg-muted text-muted-foreground',
    };
  }

  if (normalized.includes('stock')) {
    return {
      key: 'categoryBackInStock',
      className: 'bg-muted text-muted-foreground',
    };
  }

  if (normalized.includes('promo') || normalized.includes('sale')) {
    return {
      key: 'categorySalesAndDeals',
      className: 'bg-muted text-muted-foreground',
    };
  }

  if (normalized.includes('reminder')) {
    return {
      key: 'categoryReminder',
      className: 'bg-muted text-muted-foreground',
    };
  }

  return { key: 'categoryGeneral', className: 'bg-muted text-muted-foreground' };
}

export default function NotificationsPage() {
  const t = useTranslations('account.notifications');
  const locale = useLocale();
  const { user, token } = useAuthStore();
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    preferences,
    subscribe,
    unsubscribe,
    updatePreferences,
  } = usePushSubscription();

  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [serverNotifications, setServerNotifications] = useState<ServerNotification[]>([]);
  const [serverLoading, setServerLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  // Locale-aware date+time formatting; previously used Intl with `undefined`
  // (browser default) which gave inconsistent labels across visitors.
  const formatNotificationDate = useCallback(
    (timestamp: number): string => {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(timestamp);
    },
    [locale],
  );

  const refreshNotifications = useCallback(() => {
    setNotifications(getNotifications());
  }, []);

  const fetchServerNotifications = useCallback(async () => {
    // Auth is enforced server-side via the session cookie; gate on user only.
    if (!user?.id) {
      setServerNotifications([]);
      setServerLoading(false);
      return;
    }

    setServerLoading(true);
    setServerError(null);
    try {
      const response = await fetch('/api/notifications?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || t('accountFailed'));
      }

      const items = Array.isArray(result.data?.notifications)
        ? (result.data.notifications as ServerNotification[])
        : [];
      setServerNotifications(items);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('accountFailed'));
      setServerNotifications([]);
    } finally {
      setServerLoading(false);
    }
  }, [token, user?.id, t]);

  useEffect(() => {
    const initialLoadTimer = setTimeout(() => {
      refreshNotifications();
    }, 0);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATIONS_STORAGE_KEY) {
        refreshNotifications();
      }
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        setTimeout(refreshNotifications, 0);
      }
    };

    const unsubscribeLocal = onNotificationsUpdated(refreshNotifications);

    window.addEventListener('storage', handleStorage);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      clearTimeout(initialLoadTimer);
      unsubscribeLocal();
      window.removeEventListener('storage', handleStorage);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    fetchServerNotifications();
  }, [fetchServerNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );

  const handleTogglePush = async () => {
    if (isSubscribed) {
      await unsubscribe();
      showSuccess(t('toastDisabled'));
      return;
    }

    const success = await subscribe();
    if (success) {
      showSuccess(t('toastEnabled'));
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      showError(t('toastBlockedByBrowser'));
    } else {
      showError(t('toastEnableFailed'));
    }
  };

  const handleTogglePref = async (key: PreferenceKey) => {
    if (!preferences) return;

    const newValue = !preferences[key];
    const success = await updatePreferences({ [key]: newValue });

    if (!success) {
      showError(t('toastPreferenceFailed'));
    }
  };

  const handleOpenNotification = useCallback(
    (notificationId: string) => {
      markAsRead(notificationId);
      refreshNotifications();
    },
    [refreshNotifications]
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead();
    refreshNotifications();
  }, [refreshNotifications]);

  const handleClearHistory = useCallback(() => {
    clearNotifications();
    refreshNotifications();
    showSuccess(t('toastHistoryCleared'));
  }, [refreshNotifications, t]);

  return (
    <AccountLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t('heading')}</h1>

        {!isSupported && (
          <div className="bg-card border border-border rounded-xl p-6">
            <p className="text-muted-foreground">{t('unsupported')}</p>
          </div>
        )}

        {isSupported && (
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-foreground">{t('pushSection')}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {isSubscribed ? t('subscribed') : t('notSubscribed')}
                </p>
                {permission === 'denied' && (
                  <p className="text-sm text-destructive mt-1">{t('blocked')}</p>
                )}
              </div>

              <button
                onClick={handleTogglePush}
                disabled={isLoading || permission === 'denied'}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                  isSubscribed ? 'bg-primary' : 'bg-muted'
                }`}
                aria-label={t('toggleAriaLabel')}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-background transition-transform shadow-sm ${
                    isSubscribed ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {isSupported && isSubscribed && preferences && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-foreground">{t('preferencesSection')}</h2>
            <p className="text-sm text-muted-foreground">{t('preferencesIntro')}</p>

            <div className="space-y-3 mt-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={preferences.orderUpdates}
                  onChange={() => handleTogglePref('orderUpdates')}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-foreground">{t('prefOrderUpdates')}</span>
                  <p className="text-sm text-muted-foreground">{t('prefOrderUpdatesDesc')}</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={preferences.backInStock}
                  onChange={() => handleTogglePref('backInStock')}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-foreground">{t('prefBackInStock')}</span>
                  <p className="text-sm text-muted-foreground">{t('prefBackInStockDesc')}</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={preferences.promotions}
                  onChange={() => handleTogglePref('promotions')}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-foreground">{t('prefPromotions')}</span>
                  <p className="text-sm text-muted-foreground">{t('prefPromotionsDesc')}</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={preferences.news}
                  onChange={() => handleTogglePref('news')}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-foreground">{t('prefNews')}</span>
                  <p className="text-sm text-muted-foreground">{t('prefNewsDesc')}</p>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-foreground">{t('accountHistory')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('accountHistoryDesc')}</p>
          </div>

          {serverLoading ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('accountLoading')}</p>
            </div>
          ) : serverError ? (
            <div className="p-8 text-center">
              <p className="text-sm text-destructive">{serverError}</p>
            </div>
          ) : serverNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('accountEmpty')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {serverNotifications.map((notification) => {
                const category = getNotificationCategory(notification.type);
                const timestamp = Date.parse(notification.sentAt);
                return (
                  <Link
                    key={`server-${notification.id}`}
                    href={normalizeNotificationUrl(notification.url || '/')}
                    className="block p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${category.className}`}>
                            {t(category.key)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                            {t('accountBadge')}
                          </span>
                        </div>

                        <p className="font-medium text-foreground">{notification.title}</p>
                        {notification.body && (
                          <p className="text-sm text-muted-foreground mt-1">{notification.body}</p>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground whitespace-nowrap">
                        {Number.isNaN(timestamp) ? notification.sentAt : formatNotificationDate(timestamp)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">{t('deviceHistory')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t('deviceHistoryDesc')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('deviceCounts', { total: notifications.length, unread: unreadCount })}
              </p>
            </div>

            {notifications.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead}>
                    {t('markAllAsRead')}
                  </Button>
                )}

                <Button variant="ghost" size="sm" onClick={handleClearHistory}>
                  {t('clearHistory')}
                </Button>
              </div>
            )}
          </div>

          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">{t('deviceEmpty')}</p>
                {!isSubscribed && isSupported && (
                  <p className="text-xs text-muted-foreground mt-2">{t('deviceEmptyHint')}</p>
                )}
              </div>
            ) : (
              notifications.map((notification) => {
                const category = getNotificationCategory(notification.type);
                return (
                  <Link
                    key={notification.id}
                    href={normalizeNotificationUrl(notification.url)}
                    onClick={() => handleOpenNotification(notification.id)}
                    className={`block p-4 hover:bg-muted/50 transition-colors ${
                      notification.read ? '' : 'bg-primary/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${category.className}`}>
                            {t(category.key)}
                          </span>
                          {!notification.read && (
                            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                          )}
                        </div>

                        <p className="font-medium text-foreground">{notification.title}</p>
                        {notification.body && (
                          <p className="text-sm text-muted-foreground mt-1">{notification.body}</p>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatNotificationDate(notification.timestamp)}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
