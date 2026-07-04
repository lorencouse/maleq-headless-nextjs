'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Button from '@/components/ui/Button';
import SectionHeader from '@/components/ui/SectionHeader';

interface NewsletterSectionProps {
  /** Override the default homepage heading (e.g. a news-specific CTA). */
  heading?: string;
  /** Override the default homepage subtitle. */
  subtitle?: string;
}

export default function NewsletterSection({ heading, subtitle }: NewsletterSectionProps = {}) {
  const t = useTranslations('home.newsletter');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) return;

    setStatus('loading');

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(t('successMessage'));
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error || t('errorMessage'));
      }
    } catch {
      setStatus('error');
      setMessage(t('errorMessage'));
    }
  };

  return (
    <section className="py-8 sm:py-16 bg-muted/30 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          {/* Icon */}
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>

          {/* Content */}
          <SectionHeader
            title={heading ?? t('heading')}
            subtitle={subtitle ?? t('subtitle')}
            centered
            className="mb-8"
          />

          {/* Form */}
          {status === 'success' ? (
            <div className="bg-success/10 border border-success/20 rounded-xl p-6 text-center">
              <svg className="w-12 h-12 text-success mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-success dark:text-success font-medium">{message}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                required
                className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
              />
              <Button
                type="submit"
                size="lg"
                disabled={status === 'loading'}
                className="whitespace-nowrap"
              >
                {status === 'loading' ? t('submitting') : t('submit')}
              </Button>
            </form>
          )}

          {status === 'error' && (
            <p className="mt-3 text-sm text-destructive">{message}</p>
          )}

          {/* Privacy note */}
          <p className="mt-4 text-xs text-muted-foreground">
            {t('privacyNote')}
          </p>
        </div>
      </div>
    </section>
  );
}
