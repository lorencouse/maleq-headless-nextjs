'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getRecaptchaToken } from '@/lib/security/recaptcha-client';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const formStartTimeRef = useRef<number>(Date.now());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    let captchaToken: string | undefined;
    try {
      captchaToken = await getRecaptchaToken('forgot_password');
    } catch {
      setError(t('common.recaptchaError'));
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          honeypot,
          formStartTime: formStartTimeRef.current,
          captchaToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('forgotPassword.failedSend'));
      }

      setIsSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">{t('forgotPassword.successHeading')}</h2>
            <p className="text-muted-foreground mb-6">
              {t.rich('forgotPassword.successBody', {
                email: () => <span className="font-medium text-foreground">{email}</span>,
              })}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {t('forgotPassword.successSpamHint')}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setIsSubmitted(false);
                  setError(null);
                  setHoneypot('');
                  formStartTimeRef.current = Date.now();
                }}
                className="w-full py-3 px-4 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground"
              >
                {t('forgotPassword.tryAnother')}
              </button>
              <Link
                href="/login"
                className="block w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold text-center"
              >
                {t('forgotPassword.backToSignIn')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-bold text-primary">Male Q</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-foreground">{t('forgotPassword.heading')}</h1>
          <p className="mt-2 text-muted-foreground">
            {t('forgotPassword.subheading')}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                {t('common.email')}
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                placeholder={t('common.emailPlaceholder')}
              />
            </div>

            <div className="hidden" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('forgotPassword.submitting')}
                </span>
              ) : (
                t('forgotPassword.submit')
              )}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              {t('common.rememberPasswordPrompt')}{' '}
              <Link href="/login" className="text-primary hover:text-primary-hover font-medium">
                {t('common.rememberPasswordLink')}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
