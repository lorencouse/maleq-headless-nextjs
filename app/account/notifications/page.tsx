'use client';

import AccountLayout from '@/components/account/AccountLayout';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import { showSuccess, showError } from '@/lib/utils/toast';

export default function NotificationsPage() {
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

  const handleTogglePush = async () => {
    if (isSubscribed) {
      await unsubscribe();
      showSuccess('Push notifications disabled');
    } else {
      const success = await subscribe();
      if (success) {
        showSuccess('Push notifications enabled');
      } else if (Notification.permission === 'denied') {
        showError('Notifications blocked by your browser. Check your browser settings to allow notifications.');
      }
    }
  };

  const handleTogglePref = async (key: 'orderUpdates' | 'backInStock' | 'promotions') => {
    if (!preferences) return;
    const newValue = !preferences[key];
    await updatePreferences({ [key]: newValue });
  };

  if (!isSupported) {
    return (
      <AccountLayout>
        <div className="bg-card border border-border rounded-xl p-6">
          <h1 className="text-2xl font-bold text-foreground mb-4">Notifications</h1>
          <p className="text-muted-foreground">
            Push notifications are not supported in your browser. Try using Chrome, Firefox, or Edge for notification support.
          </p>
        </div>
      </AccountLayout>
    );
  }

  return (
    <AccountLayout>
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Notifications</h1>

      {/* Push toggle */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between">
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
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                isSubscribed ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Preference checkboxes (only visible when subscribed) */}
      {isSubscribed && preferences && (
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
                <span className="font-medium text-foreground">Promotions & Deals</span>
                <p className="text-sm text-muted-foreground">
                  Sales, special offers, and exclusive deals
                </p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
    </AccountLayout>
  );
}
