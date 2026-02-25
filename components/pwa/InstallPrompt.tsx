'use client';

import { useState, useEffect, useRef } from 'react';
import { event as gaEvent } from '@/lib/analytics/gtag';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'maleq-install-prompt-dismissed';
const INSTALL_VISITS_KEY = 'maleq-install-visit-count';
type InstallMode = 'prompt' | 'manual-ios' | 'manual-macos';

function isStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function detectManualInstallMode(): Exclude<InstallMode, 'prompt'> | null {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const isMacSafari =
    /Macintosh/i.test(ua) &&
    /Safari/i.test(ua) &&
    !isIOS &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);

  if (isIOS) return 'manual-ios';
  if (isMacSafari) return 'manual-macos';
  return null;
}

export default function InstallPrompt({ minVisits = 2 }: { minVisits?: number }) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<InstallMode>('prompt');

  useEffect(() => {
    let manualPromptTimer: ReturnType<typeof setTimeout> | undefined;

    // Hide if already installed (standalone mode)
    if (isStandaloneMode()) return;

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

    const manualMode = detectManualInstallMode();
    if (manualMode && hasEnoughVisits) {
      manualPromptTimer = setTimeout(() => {
        setMode(manualMode);
        setVisible(true);
        gaEvent({
          action: 'pwa_install_manual_prompt_shown',
          category: 'PWA',
          label: manualMode,
        });
      }, 0);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      if (hasEnoughVisits) {
        setMode('prompt');
        setVisible(true);
        gaEvent({ action: 'pwa_install_prompt_shown', category: 'PWA' });
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Track actual install (fires after user installs from any source)
    const installHandler = () => {
      gaEvent({ action: 'pwa_app_installed', category: 'PWA' });
      setVisible(false);
    };
    window.addEventListener('appinstalled', installHandler);

    return () => {
      if (manualPromptTimer) clearTimeout(manualPromptTimer);
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installHandler);
    };
  }, [minVisits]);

  if (!visible) return null;

  const handleInstall = async () => {
    if (mode !== 'prompt' || !deferredPrompt.current) return;
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
    gaEvent({
      action: mode === 'prompt' ? 'pwa_install_prompt_dismissed' : 'pwa_install_manual_prompt_dismissed',
      category: 'PWA',
      label: mode,
    });
    setVisible(false);
  };

  const title =
    mode === 'manual-ios'
      ? 'Install on iPhone/iPad'
      : mode === 'manual-macos'
        ? 'Install on Mac'
        : 'Install Male Q';

  const description =
    mode === 'manual-ios'
      ? 'Open the Share menu, then tap Add to Home Screen to install this app.'
      : mode === 'manual-macos'
        ? 'In Safari, use File > Add to Dock to install this app on your Mac.'
        : 'Add Male Q to your home screen for faster access and a better experience.';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {description}
          </p>
          <div className="flex flex-wrap gap-3">
            {mode === 'prompt' && (
              <button
                onClick={handleInstall}
                className="px-4 py-2.5 min-h-[44px] bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
              >
                Install App
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              {mode === 'prompt' ? 'Not now' : 'Got it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
