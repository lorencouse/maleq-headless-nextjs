'use client';

import { useState, useEffect, useCallback } from 'react';
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

export function usePushSubscription() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  // Load preferences when we have an endpoint
  useEffect(() => {
    if (!endpoint) return;

    fetch(`/api/push/preferences?endpoint=${encodeURIComponent(endpoint)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          setPreferences(data.data);
        }
      })
      .catch(() => {});
  }, [endpoint]);

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

      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error('VAPID public key not configured');
        setIsLoading(false);
        return false;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const subJson = subscription.toJSON();
      const ep = subJson.endpoint!;

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ep,
          keys: {
            p256dh: subJson.keys!.p256dh,
            auth: subJson.keys!.auth,
          },
          customerId,
          email,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setIsLoading(false);
        return false;
      }

      localStorage.setItem(PUSH_SUBSCRIBED_KEY, 'true');
      localStorage.setItem(PUSH_ENDPOINT_KEY, ep);
      setIsSubscribed(true);
      setEndpoint(ep);
      setPreferences({ orderUpdates: true, backInStock: true, promotions: true });
      setIsLoading(false);
      return true;
    } catch (err) {
      console.error('[Push] Subscription failed:', err);
      setIsLoading(false);
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
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
    async (prefs: Partial<NotificationPreferences>) => {
      if (!endpoint) return;

      try {
        await fetch('/api/push/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, ...prefs }),
        });

        setPreferences((prev) =>
          prev ? { ...prev, ...prefs } : null
        );
      } catch (err) {
        console.error('Failed to update preferences:', err);
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
