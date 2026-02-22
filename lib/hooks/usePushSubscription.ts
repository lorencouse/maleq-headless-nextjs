'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import type { NotificationPreferences } from '@/lib/push/types';

const PUSH_SUBSCRIBED_KEY = 'maleq-push-subscribed';
const PUSH_ENDPOINT_KEY = 'maleq-push-endpoint';

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

export function usePushSubscription() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
      const savedEndpoint = localStorage.getItem(PUSH_ENDPOINT_KEY);
      const savedSubscribed = localStorage.getItem(PUSH_SUBSCRIBED_KEY) === 'true';
      setIsSubscribed(savedSubscribed);
      setEndpoint(savedEndpoint);

      // Verify the subscription is still active
      if (savedSubscribed) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.pushManager.getSubscription().then((sub) => {
            if (!sub) {
              // Subscription was revoked
              localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
              localStorage.removeItem(PUSH_ENDPOINT_KEY);
              setIsSubscribed(false);
              setEndpoint(null);
            }
          });
        });
      }
    }
  }, []);

  // Load preferences when we have an endpoint (use POST to avoid endpoint in query params)
  useEffect(() => {
    if (!endpoint) return;

    fetch('/api/push/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          setPreferences(data.data);
        }
      })
      .catch(() => {});
  }, [endpoint]);

  // When a user logs in and already has a subscription, link it to their customer ID
  useEffect(() => {
    if (!endpoint || !isAuthenticated || !user?.id) return;

    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) return;
        const subJson = sub.toJSON();
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
            customerId: user.id,
            email: user.email,
          }),
        }).catch(() => {});
      })
    );
  }, [isAuthenticated, user?.id, endpoint]);

  const subscribe = useCallback(async (customerId?: number, email?: string) => {
    if (!isSupported) return false;
    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setIsLoading(false);
        return false;
      }

      // Wait for SW with a timeout — iOS Safari can hang here if SW failed to activate
      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        10_000,
        'Service worker ready'
      );

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error('VAPID public key not configured');
        setIsLoading(false);
        return false;
      }

      // Pass Uint8Array directly — iOS Safari is more reliable with this than ArrayBuffer
      const applicationServerKey = urlBase64ToUint8Array(vapidKey) as BufferSource;

      let subscription: PushSubscription;
      try {
        subscription = await withTimeout(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }),
          15_000,
          'Push subscription'
        );
      } catch (subErr) {
        console.error('[Push] pushManager.subscribe() failed:', subErr);
        setIsLoading(false);
        return false;
      }

      const subJson = subscription.toJSON();
      const ep = subJson.endpoint!;

      // Use auth store data if customerId/email not explicitly provided
      const cid = customerId ?? (user?.id || undefined);
      const em = email ?? (user?.email || undefined);

      let res: Response;
      try {
        res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: ep,
            keys: {
              p256dh: subJson.keys!.p256dh,
              auth: subJson.keys!.auth,
            },
            customerId: cid,
            email: em,
          }),
        });
      } catch (fetchErr) {
        console.error('[Push] API fetch failed:', fetchErr);
        setIsLoading(false);
        return false;
      }

      const data = await res.json();

      if (!data.success) {
        console.error('[Push] API returned error:', res.status, data);
        setIsLoading(false);
        return false;
      }

      localStorage.setItem(PUSH_SUBSCRIBED_KEY, 'true');
      localStorage.setItem(PUSH_ENDPOINT_KEY, ep);
      setIsSubscribed(true);
      setEndpoint(ep);

      // Fetch actual preferences from server rather than assuming defaults
      try {
        const prefRes = await fetch('/api/push/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: ep }),
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

      setIsLoading(false);
      return true;
    } catch (err) {
      console.error('[Push] Subscription failed:', err);
      setIsLoading(false);
      return false;
    }
  }, [isSupported, user?.id, user?.email]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Delete server-side first, then browser-side
        const res = await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        if (res.ok) {
          await subscription.unsubscribe();
        }
      }

      localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
      localStorage.removeItem(PUSH_ENDPOINT_KEY);
      setIsSubscribed(false);
      setEndpoint(null);
      setPreferences(null);
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updatePreferences = useCallback(
    async (prefs: Partial<NotificationPreferences>): Promise<boolean> => {
      if (!endpoint) return false;

      try {
        const res = await fetch('/api/push/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, ...prefs }),
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
    [endpoint]
  );

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    endpoint,
    preferences,
    subscribe,
    unsubscribe,
    updatePreferences,
  };
}
