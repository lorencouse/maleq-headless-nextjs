'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// ChatWidget is ~1,100 lines + a decision tree. It starts closed and isn't
// needed for first paint, so load its chunk only after the browser is idle
// (or shortly after hydration as a fallback). This keeps it out of the
// critical client bundle on every page.
const ChatWidget = dynamic(() => import('@/components/chat/ChatWidget'), {
  ssr: false,
});

export default function LazyChatWidget() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setReady(true));
      return () => w.cancelIdleCallback?.(id);
    }

    const t = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  if (!ready) return null;
  return <ChatWidget />;
}
