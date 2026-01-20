'use client';

import { useState, useEffect } from 'react';
import { isSubscribed, markAsSubscribed, isValidEmail } from '@/lib/utils/newsletter';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';

interface NewsletterSignupProps {
  source?: 'footer' | 'popup' | 'checkout' | 'page';
  variant?: 'inline' | 'stacked' | 'minimal';
  showTitle?: boolean;
  showDescription?: boolean;
  title?: string;
  description?: string;
  buttonText?: string;
  placeholder?: string;
  className?: string;
  onSuccess?: () => void;
}

export default function NewsletterSignup({
  source = 'footer',
  variant = 'inline',
  showTitle = false,
  showDescription = false,
  title = 'Subscribe to Our Newsletter',
  description = 'Get updates on new products, exclusive offers, and more.',
  buttonText = 'Subscribe',
  placeholder = 'Your email',
  className = '',
  onSuccess,
}: NewsletterSignupProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAlreadySubscribed, setIsAlreadySubscribed] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    setIsAlreadySubscribed(isSubscribed());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      });

      const result = await response.json();

      if (result.success) {
        setSubscribed(true);
        markAsSubscribed();
        showSuccessToast(result.message);
        setEmail('');
        onSuccess?.();
      } else {
        setError(result.message);
        showErrorToast(result.message);
      }
    } catch {
      setError('Failed to subscribe. Please try again.');
      showErrorToast('Failed to subscribe. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Already subscribed state
  if (isAlreadySubscribed || subscribed) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>You&apos;re subscribed to our newsletter!</span>
        </div>
      </div>
    );
  }

  // Inline variant (footer style)
  if (variant === 'inline') {
    return (
      <div className={className}>
        {showTitle && (
          <h4 className="text-foreground text-sm font-semibold mb-4">{title}</h4>
        )}
        {showDescription && (
          <p className="text-sm mb-4">{description}</p>
        )}
        <form onSubmit={handleSubmit} className="flex">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            disabled={isLoading}
            className="flex-1 px-3 py-2 bg-input text-foreground text-sm rounded-l border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-r hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              buttonText
            )}
          </button>
        </form>
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  // Stacked variant (larger, centered)
  if (variant === 'stacked') {
    return (
      <div className={`text-center ${className}`}>
        {showTitle && (
          <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
        )}
        {showDescription && (
          <p className="text-muted-foreground mb-4">{description}</p>
        )}
        <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Subscribing...' : buttonText}
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  // Minimal variant (just input and button)
  return (
    <div className={className}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder={placeholder}
          disabled={isLoading}
          className="flex-1 px-3 py-2 bg-input text-foreground text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {isLoading ? '...' : buttonText}
        </button>
      </form>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
