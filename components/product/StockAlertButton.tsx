'use client';

import { useState, useEffect } from 'react';
import {
  isSubscribedToAlert,
  addStockAlert,
  removeStockAlert,
  getAlertEmail,
} from '@/lib/utils/stock-alerts';
import { isValidEmail } from '@/lib/api/validation';
import { showSuccess, showError } from '@/lib/utils/toast';

interface StockAlertButtonProps {
  productId: string;
  productName: string;
  variant?: 'button' | 'inline';
  className?: string;
}

export default function StockAlertButton({
  productId,
  productName,
  variant = 'button',
  className = '',
}: StockAlertButtonProps) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const subscribed = isSubscribedToAlert(productId);
    setIsSubscribed(subscribed);
    if (subscribed) {
      const savedEmail = getAlertEmail(productId);
      if (savedEmail) setEmail(savedEmail);
    }
  }, [productId]);

  const handleSubscribe = async () => {
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
      const response = await fetch('/api/stock-alerts/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          productName,
          email: email.trim(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        addStockAlert({ productId, productName, email: email.trim() });
        setIsSubscribed(true);
        setShowForm(false);
        showSuccess(result.message);
      } else {
        setError(result.message);
        showError(result.message);
      }
    } catch {
      setError('Failed to subscribe. Please try again.');
      showError('Failed to subscribe. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setIsLoading(true);

    try {
      await fetch(
        `/api/stock-alerts/subscribe?productId=${productId}&email=${encodeURIComponent(email)}`,
        { method: 'DELETE' }
      );

      removeStockAlert(productId);
      setIsSubscribed(false);
      setEmail('');
      showSuccess('Stock alert removed');
    } catch {
      showError('Failed to remove alert');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubscribe();
    }
    if (e.key === 'Escape') {
      setShowForm(false);
      setError(null);
    }
  };

  // Subscribed state
  if (isSubscribed) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-2 p-3 bg-info/10 rounded-lg">
          <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-info">
              Stock alert set!
            </p>
            <p className="text-xs text-info/80">
              We&apos;ll email {email} when available
            </p>
          </div>
          <button
            onClick={handleUnsubscribe}
            disabled={isLoading}
            className="px-3 py-2 min-h-[44px] text-sm text-info hover:text-info-hover hover:bg-info/10 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? '...' : 'Remove'}
          </button>
        </div>
      </div>
    );
  }

  // Button variant - shows form on click
  if (variant === 'button') {
    if (!showForm) {
      return (
        <button
          onClick={() => setShowForm(true)}
          className={`w-full py-3 px-6 border-2 border-info text-info rounded-lg hover:bg-info/10 transition-colors font-semibold flex items-center justify-center gap-2 ${className}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          Notify Me When Available
        </button>
      );
    }

    return (
      <div className={`p-4 border border-border rounded-lg bg-muted/30 ${className}`}>
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="font-medium text-foreground">Get Stock Alert</span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Enter your email to be notified when this item is back in stock.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Your email"
            disabled={isLoading}
            className="flex-1 px-3 py-2.5 min-h-[44px] text-sm border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={handleSubscribe}
            disabled={isLoading || !email.trim()}
            className="px-4 py-2.5 min-h-[44px] bg-info text-info-foreground text-sm font-medium rounded-lg hover:bg-info-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '...' : 'Notify'}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        )}
        <button
          onClick={() => {
            setShowForm(false);
            setError(null);
          }}
          className="mt-2 px-3 py-2 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // Inline variant
  return (
    <div className={`flex gap-2 ${className}`}>
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Email for stock alert"
        disabled={isLoading}
        className="flex-1 px-3 py-2.5 min-h-[44px] text-sm border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
      />
      <button
        onClick={handleSubscribe}
        disabled={isLoading || !email.trim()}
        className="px-4 py-2.5 min-h-[44px] bg-info text-info-foreground text-sm font-medium rounded-lg hover:bg-info-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {isLoading ? '...' : 'Notify Me'}
      </button>
    </div>
  );
}
