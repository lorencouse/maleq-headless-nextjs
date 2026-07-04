'use client';

import { useEffect } from 'react';
import toast from 'react-hot-toast';

export default function OfflineIndicator() {
  useEffect(() => {
    let toastId: string | undefined;

    function handleOffline() {
      toastId = toast('You\'re offline — browsing cached content', {
        duration: Infinity,
        id: 'offline-indicator',
      });
    }

    function handleOnline() {
      toast.dismiss('offline-indicator');
      toast.success('You\'re back online', { duration: 2000 });
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // Show toast if already offline on mount
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (toastId) toast.dismiss(toastId);
    };
  }, []);

  return null;
}
