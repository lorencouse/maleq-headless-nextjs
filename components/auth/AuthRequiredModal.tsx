'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui/Button';

interface AuthRequiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  returnTo?: string;
}

export default function AuthRequiredModal({
  isOpen,
  onClose,
  title,
  description,
  returnTo = '/',
}: AuthRequiredModalProps) {
  const t = useTranslations('auth.modal');
  // Defaults are resolved at render time so they respect the current locale.
  const resolvedTitle = title ?? t('defaultTitle');
  const resolvedDescription = description ?? t('defaultDescription');
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const encodedReturnTo = encodeURIComponent(returnTo);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-required-title"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t('closeAriaLabel')}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 id="auth-required-title" className="text-xl font-semibold text-foreground">
          {resolvedTitle}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">{resolvedDescription}</p>

        <div className="mt-6 space-y-3">
          <ButtonLink
            href={`/login?returnTo=${encodedReturnTo}`}
            onClick={onClose}
            size="lg"
            className="w-full"
          >
            {t('signIn')}
          </ButtonLink>
          <ButtonLink
            href={`/register?returnTo=${encodedReturnTo}`}
            onClick={onClose}
            variant="ghost"
            size="lg"
            className="w-full"
          >
            {t('createAccount')}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
