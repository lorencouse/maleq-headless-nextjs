'use client';

import { useState, useEffect, useRef } from 'react';
import { event as gaEvent } from '@/lib/analytics/gtag';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'maleq-install-prompt-dismissed';
const INSTALL_VISITS_KEY = 'maleq-install-visit-count';

export default function InstallPrompt({ minVisits = 2 }: { minVisits?: number }) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Hide if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Hide if dismissed
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      return; // localStorage unavailable — don't show prompt
    }

    // Track visits
    let hasEnoughVisits = true;
    try {
      const visits = parseInt(localStorage.getItem(INSTALL_VISITS_KEY) || '0', 10) + 1;
      localStorage.setItem(INSTALL_VISITS_KEY, String(visits));
      hasEnoughVisits = visits >= minVisits;
    } catch {
      // localStorage unavailable — show prompt anyway
    }

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      if (hasEnoughVisits) {
        setVisible(true);
        gaEvent({ action: 'pwa_install_prompt_shown', category: 'PWA' });
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Track actual install (fires after user installs from any source)
    const installHandler = () => {
      gaEvent({ action: 'pwa_app_installed', category: 'PWA' });
    };
    window.addEventListener('appinstalled', installHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installHandler);
    };
  }, [minVisits]);

  if (!visible) return null;

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    gaEvent({ action: 'pwa_install_prompt_clicked', category: 'PWA' });
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    gaEvent({
      action: outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed',
      category: 'PWA',
    });
    if (outcome === 'accepted') {
      setVisible(false);
    }
    deferredPrompt.current = null;
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    gaEvent({ action: 'pwa_install_prompt_dismissed', category: 'PWA' });
    setVisible(false);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground mb-1">Install Male Q</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add Male Q to your home screen for faster access and a better experience.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleInstall}
              className="px-4 py-2.5 min-h-[44px] bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
            >
              Install App
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
