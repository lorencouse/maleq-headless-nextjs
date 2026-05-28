'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

type PreferenceKey = 'orderUpdates' | 'backInStock' | 'promotions';

interface ServerNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  url: string | null;
  sentAt: string;
}

function formatNotificationDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
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

function getNotificationCategory(type: string): { label: string; className: string } {
  const normalized = type.toLowerCase();

  if (normalized.includes('order') || normalized.includes('tracking')) {
    return {
      label: 'Order Update',
      className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    };
  }

  if (normalized.includes('stock')) {
    return {
      label: 'Back in Stock',
      className: 'bg-green-500/10 text-green-700 dark:text-green-300',
    };
  }

  if (normalized.includes('promo') || normalized.includes('sale')) {
    return {
      label: 'Sales and Deals',
      className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
    };
  }

  if (normalized.includes('reminder')) {
    return {
      label: 'Reminder',
      className: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
    };
  }

  return { label: 'General', className: 'bg-muted text-muted-foreground' };
}

export default function NotificationsPage() {
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

  const refreshNotifications = useCallback(() => {
    setNotifications(getNotifications());
  }, []);

  const fetchServerNotifications = useCallback(async () => {
    if (!user?.id || !token) {
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
        throw new Error(result.error || 'Failed to load notification history');
      }

      const items = Array.isArray(result.data?.notifications)
        ? (result.data.notifications as ServerNotification[])
        : [];
      setServerNotifications(items);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Failed to load notification history');
      setServerNotifications([]);
    } finally {
      setServerLoading(false);
    }
  }, [token, user?.id]);

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
      showSuccess('Push notifications disabled');
      return;
    }

    const success = await subscribe();
    if (success) {
      showSuccess('Push notifications enabled');
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      showError('Notifications blocked by your browser. Check your browser settings to allow notifications.');
    } else {
      showError('Could not enable notifications. Please try again.');
    }
  };

  const handleTogglePref = async (key: PreferenceKey) => {
    if (!preferences) return;

    const newValue = !preferences[key];
    const success = await updatePreferences({ [key]: newValue });

    if (!success) {
      showError('Failed to update preference. Please try again.');
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
    showSuccess('Notification history cleared');
  }, [refreshNotifications]);

  return (
    <AccountLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>

        {!isSupported && (
          <div className="bg-card border border-border rounded-xl p-6">
            <p className="text-muted-foreground">
              Push notifications are not available in this browser context. On iPhone/iPad, install Male Q to Home Screen and open it as a web app. On desktop, use the latest Safari, Chrome, or Edge.
            </p>
          </div>
        )}

        {isSupported && (
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-foreground">Push Notifications</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {isSubscribed
                    ? 'You are receiving push notifications'
                    : 'Enable push notifications to stay updated'}
                </p>
                {permission === 'denied' && (
                  <p className="text-sm text-destructive mt-1">
                    Notifications are blocked by your browser. Update your browser settings to enable them.
                  </p>
                )}
              </div>

              <button
                onClick={handleTogglePush}
                disabled={isLoading || permission === 'denied'}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                  isSubscribed ? 'bg-primary' : 'bg-muted'
                }`}
                aria-label="Toggle push notifications"
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                    isSubscribed ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {isSupported && isSubscribed && preferences && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-foreground">Notification Preferences</h2>
            <p className="text-sm text-muted-foreground">
              Choose which types of notifications you want to receive.
            </p>

            <div className="space-y-3 mt-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={preferences.orderUpdates}
                  onChange={() => handleTogglePref('orderUpdates')}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                />
                <div>
                  <span className="font-medium text-foreground">Order Updates</span>
                  <p className="text-sm text-muted-foreground">
                    Shipping confirmations, delivery updates, and order status changes
                  </p>
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
                  <span className="font-medium text-foreground">Back in Stock</span>
                  <p className="text-sm text-muted-foreground">
                    Get notified when products you want are available again
                  </p>
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
                  <span className="font-medium text-foreground">Promotions and Deals</span>
                  <p className="text-sm text-muted-foreground">
                    Sales, special offers, and exclusive deals
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-foreground">Account Notification History</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Cross-device history for notifications linked to your account.
            </p>
          </div>

          {serverLoading ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">Loading account notifications...</p>
            </div>
          ) : serverError ? (
            <div className="p-8 text-center">
              <p className="text-sm text-destructive">{serverError}</p>
            </div>
          ) : serverNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No account-level notifications yet.</p>
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
                            {category.label}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                            Account
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
              <h2 className="font-semibold text-foreground">This Device Notification History</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Activity log for order updates, tracking notices, sales, reminders, and stock alerts on this device.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {notifications.length} total, {unreadCount} unread
              </p>
            </div>

            {notifications.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Mark all as read
                  </button>
                )}

                <button
                  onClick={handleClearHistory}
                  className="px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Clear history
                </button>
              </div>
            )}
          </div>

          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
                {!isSubscribed && isSupported && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Enable push notifications to start building your history.
                  </p>
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
                            {category.label}
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
