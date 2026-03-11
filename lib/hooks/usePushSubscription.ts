'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import type { NotificationPreferences } from '@/lib/push/types';

const PUSH_SUBSCRIBED_KEY = 'maleq-push-subscribed';
const PUSH_ENDPOINT_KEY = 'maleq-push-endpoint';
export const PUSH_OWNERSHIP_TOKEN_KEY = 'maleq-push-ownership-token';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Wrap a promise with a timeout so it doesn't hang forever (iOS Safari issue) */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Check if Declarative Web Push is available (modern Safari / iOS web apps).
 * window.pushManager is exposed when the browser supports subscribing
 * without a service worker.
 */
function hasDeclarativePush(): boolean {
  return typeof window !== 'undefined' && 'pushManager' in window;
}

/**
 * Get a PushManager — prefers window.pushManager (Declarative Web Push)
 * over the traditional SW-based pushManager.
 */
async function getPushManager(): Promise<PushManager> {
  // Declarative Web Push: window.pushManager
  if (hasDeclarativePush()) {
    return (window as unknown as { pushManager: PushManager }).pushManager;
  }

  // Traditional: service worker registration pushManager
  if ('serviceWorker' in navigator) {
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      10_000,
      'Service worker ready'
    );
    return registration.pushManager;
  }

  throw new Error('No push manager available');
}

export function usePushSubscription() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [ownershipToken, setOwnershipToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const token = useAuthStore((state) => state.token);
  const { user, isAuthenticated } = useAuthStore();

  const persistLocalSubscription = useCallback((ep: string, token: string) => {
    try {
      localStorage.setItem(PUSH_SUBSCRIBED_KEY, 'true');
      localStorage.setItem(PUSH_ENDPOINT_KEY, ep);
      localStorage.setItem(PUSH_OWNERSHIP_TOKEN_KEY, token);
    } catch {
      // localStorage unavailable
    }
    setIsSubscribed(true);
    setEndpoint(ep);
    setOwnershipToken(token);
  }, []);

  const clearLocalSubscription = useCallback(() => {
    try {
      localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
      localStorage.removeItem(PUSH_ENDPOINT_KEY);
      localStorage.removeItem(PUSH_OWNERSHIP_TOKEN_KEY);
    } catch {
      // localStorage unavailable
    }
    setIsSubscribed(false);
    setEndpoint(null);
    setOwnershipToken(null);
    setPreferences(null);
  }, []);

  const upsertSubscription = useCallback(async (
    subscriptionJson: PushSubscriptionJSON,
    customerId?: number,
    email?: string
  ): Promise<{ endpoint: string; ownershipToken: string } | null> => {
    const ep = subscriptionJson.endpoint;
    const p256dh = subscriptionJson.keys?.p256dh;
    const auth = subscriptionJson.keys?.auth;
    if (!ep || !p256dh || !auth) return null;

    let res: Response;
    try {
      res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          endpoint: ep,
          keys: { p256dh, auth },
          customerId,
          email,
        }),
      });
    } catch {
      return null;
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      return null;
    }

    if (!res.ok || typeof data !== 'object' || data === null || !('success' in data)) {
      return null;
    }
    const success = (data as { success?: unknown }).success;
    if (success !== true) return null;

    const tokenValue = (data as { data?: { ownershipToken?: unknown } }).data?.ownershipToken;
    if (typeof tokenValue !== 'string' || tokenValue.length === 0) return null;

    persistLocalSubscription(ep, tokenValue);
    return { endpoint: ep, ownershipToken: tokenValue };
  }, [persistLocalSubscription, token]);

  useEffect(() => {
    const supported =
      'Notification' in window &&
      (hasDeclarativePush() || ('serviceWorker' in navigator && 'PushManager' in window));
    setIsSupported(supported);
    if (!supported) return;

    setPermission(Notification.permission);

    let savedEndpoint: string | null = null;
    let savedToken: string | null = null;

    try {
      savedEndpoint = localStorage.getItem(PUSH_ENDPOINT_KEY);
      savedToken = localStorage.getItem(PUSH_OWNERSHIP_TOKEN_KEY);
      const savedSubscribed = localStorage.getItem(PUSH_SUBSCRIBED_KEY) === 'true';
      setIsSubscribed(savedSubscribed);
      setEndpoint(savedEndpoint);
      setOwnershipToken(savedToken);
    } catch {
      // localStorage unavailable
    }

    getPushManager()
      .then((pm) => pm.getSubscription())
      .then(async (sub) => {
        if (!sub) {
          clearLocalSubscription();
          return;
        }

        const subJson = sub.toJSON();
        if (!subJson.endpoint) return;

        if (!savedToken || savedEndpoint !== subJson.endpoint) {
          await upsertSubscription(subJson);
        }
      })
      .catch(() => {});
  }, [clearLocalSubscription, upsertSubscription]);

  // Load preferences when we have an endpoint (use POST to avoid endpoint in query params)
  useEffect(() => {
    if (!endpoint || !ownershipToken) return;

    fetch('/api/push/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, ownershipToken }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          setPreferences(data.data);
        }
      })
      .catch(() => {});
  }, [endpoint, ownershipToken]);

  // When a user logs in and already has a subscription, link it to their customer ID
  useEffect(() => {
    if (!endpoint || !isAuthenticated || !user?.id) return;

    getPushManager()
      .then((pm) => pm.getSubscription())
      .then((sub) => {
        if (!sub) return;
        return upsertSubscription(sub.toJSON(), user.id, user.email);
      })
      .catch(() => {});
  }, [isAuthenticated, user?.id, user?.email, endpoint, upsertSubscription]);

  const subscribe = useCallback(async (customerId?: number, email?: string) => {
    if (!isSupported) return false;
    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return false;

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error('[Push] VAPID public key not configured');
        return false;
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidKey) as BufferSource;

      // Get the push manager (Declarative or SW-based)
      let pushManager: PushManager;
      try {
        pushManager = await getPushManager();
      } catch (pmErr) {
        console.error('[Push] Failed to get push manager:', pmErr);
        return false;
      }

      let subscription: PushSubscription;
      try {
        subscription = await withTimeout(
          pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }),
          15_000,
          'Push subscription'
        );
      } catch (subErr) {
        console.error('[Push] pushManager.subscribe() failed:', subErr);
        return false;
      }

      const subJson = subscription.toJSON();

      // Use auth store data if customerId/email not explicitly provided
      const cid = customerId ?? (user?.id || undefined);
      const em = email ?? (user?.email || undefined);

      const registered = await upsertSubscription(subJson, cid, em);
      if (!registered) {
        console.error('[Push] Failed to save subscription on server');
        return false;
      }

      // Fetch actual preferences from server rather than assuming defaults
      try {
        const prefRes = await fetch('/api/push/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: registered.endpoint,
            ownershipToken: registered.ownershipToken,
          }),
        });
        const prefData = await prefRes.json();
        if (prefData.success && prefData.data) {
          setPreferences(prefData.data);
        } else {
          setPreferences({ orderUpdates: true, backInStock: true, promotions: true });
        }
      } catch {
        setPreferences({ orderUpdates: true, backInStock: true, promotions: true });
      }

      return true;
    } catch (err) {
      console.error('[Push] Subscription failed:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, upsertSubscription, user?.id, user?.email]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);

    try {
      const pushManager = await getPushManager();
      const subscription = await pushManager.getSubscription();

      if (subscription) {
        let tokenForDelete = ownershipToken;
        if (!tokenForDelete) {
          try {
            tokenForDelete = localStorage.getItem(PUSH_OWNERSHIP_TOKEN_KEY);
          } catch {
            tokenForDelete = null;
          }
        }

        if (!tokenForDelete) {
          const recovered = await upsertSubscription(
            subscription.toJSON(),
            user?.id || undefined,
            user?.email || undefined
          );
          tokenForDelete = recovered?.ownershipToken || null;
        }

        // Best-effort server cleanup, then always unsubscribe browser-side.
        if (tokenForDelete) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
              ownershipToken: tokenForDelete,
            }),
          }).catch(() => {});
        }

        await subscription.unsubscribe().catch(() => {});
      }

      clearLocalSubscription();
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [clearLocalSubscription, ownershipToken, upsertSubscription, user?.id, user?.email]);

  const updatePreferences = useCallback(
    async (prefs: Partial<NotificationPreferences>): Promise<boolean> => {
      if (!endpoint || !ownershipToken) return false;

      try {
        const res = await fetch('/api/push/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, ownershipToken, ...prefs }),
        });
        const data = await res.json();

        if (data.success) {
          setPreferences((prev) =>
            prev ? { ...prev, ...prefs } : null
          );
          return true;
        }

        return false;
      } catch (err) {
        console.error('Failed to update preferences:', err);
        return false;
      }
    },
    [endpoint, ownershipToken]
  );

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    endpoint,
    ownershipToken,
    preferences,
    subscribe,
    unsubscribe,
    updatePreferences,
  };
}
