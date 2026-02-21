'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export default function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Check initial state
    setIsOffline(!navigator.onLine);

    let toastId: string | undefined;

    function handleOffline() {
      setIsOffline(true);
      toastId = toast('You\'re offline — browsing cached content', {
        icon: '📡',
        duration: Infinity,
        id: 'offline-indicator',
      });
    }

    function handleOnline() {
      setIsOffline(false);
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
