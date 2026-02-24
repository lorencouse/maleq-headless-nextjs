'use client';

type RecaptchaAction =
  | 'login'
  | 'register'
  | 'forgot_password'
  | 'reset_password';

interface GrecaptchaApi {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: RecaptchaAction }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaApi;
  }
}

const RECAPTCHA_SCRIPT_ID = 'recaptcha-v3-script';
let scriptLoadPromise: Promise<void> | null = null;

function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('reCAPTCHA requires a browser environment'));
  }

  if (window.grecaptcha) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const markLoaded = () => {
      if (window.grecaptcha) {
        resolve();
        return;
      }
      reject(new Error('reCAPTCHA script loaded but API was unavailable'));
    };

    const handleError = () => {
      reject(new Error('Failed to load reCAPTCHA script'));
    };

    const existingScript = document.getElementById(RECAPTCHA_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', markLoaded, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = RECAPTCHA_SCRIPT_ID;
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', markLoaded, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoadPromise = null;
    throw error;
  });

  return scriptLoadPromise;
}

export async function getRecaptchaToken(action: RecaptchaAction): Promise<string | undefined> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    return undefined;
  }

  await loadRecaptchaScript(siteKey);

  if (!window.grecaptcha) {
    throw new Error('reCAPTCHA API unavailable');
  }

  return new Promise<string>((resolve, reject) => {
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) {
      reject(new Error('reCAPTCHA API unavailable'));
      return;
    }

    grecaptcha.ready(() => {
      grecaptcha
        .execute(siteKey, { action })
        .then((token) => resolve(token))
        .catch((error) => reject(error));
    });
  });
}
