'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store/auth-store';
import * as gtag from '@/lib/analytics/gtag';
import { getRecaptchaToken } from '@/lib/security/recaptcha-client';
import { getGoogleLocale } from '@/lib/auth/google-locale';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
}

interface GoogleButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsId;
      };
    };
  }
}

const GSI_SCRIPT_ID = 'google-gsi-client';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let gsiScriptPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('GSI requires a browser environment'));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (gsiScriptPromise) {
    return gsiScriptPromise;
  }

  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Google script')), {
      once: true,
    });
    document.head.appendChild(script);
  }).catch((error) => {
    gsiScriptPromise = null;
    throw error;
  });

  return gsiScriptPromise;
}

interface GoogleSignInButtonProps {
  returnTo?: string | null;
  text?: GoogleButtonOptions['text'];
}

export default function GoogleSignInButton({ returnTo, text = 'continue_with' }: GoogleSignInButtonProps) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const { login, setError } = useAuthStore();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (!response.credential) {
        setError(t('google.failedGeneric'));
        return;
      }

      let captchaToken: string | undefined;
      try {
        captchaToken = await getRecaptchaToken('login');
      } catch {
        setError(t('common.recaptchaError'));
        return;
      }

      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential, captchaToken }),
        });
        const result = await res.json();
        if (!res.ok) {
          throw new Error(result.error || t('google.failedGeneric'));
        }
        login(result.user);
        gtag.login('google');
        router.replace(returnTo || '/account');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('google.failedGeneric'));
      }
    },
    [login, returnTo, router, setError, t]
  );

  useEffect(() => {
    if (!clientId) {
      setUnavailable(true);
      return;
    }

    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled) return;
        const gid = window.google?.accounts?.id;
        if (!gid || !buttonRef.current) {
          setUnavailable(true);
          return;
        }
        gid.initialize({ client_id: clientId, callback: handleCredential });
        gid.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 320,
          locale: getGoogleLocale(locale),
        });
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, handleCredential, locale, text]);

  if (!clientId || unavailable) {
    return null;
  }

  return <div ref={buttonRef} className="flex justify-center" aria-label={t('google.continueWith')} />;
}
