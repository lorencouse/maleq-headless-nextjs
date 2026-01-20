'use client';

import { useState, useEffect, useCallback } from 'react';
import { isSubscribed, isPopupDismissed, dismissPopup } from '@/lib/utils/newsletter';
import NewsletterSignup from './NewsletterSignup';

interface NewsletterPopupProps {
  delay?: number; // Milliseconds before showing popup
  showOnExitIntent?: boolean;
}

export default function NewsletterPopup({
  delay = 30000, // 30 seconds default
  showOnExitIntent = true,
}: NewsletterPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasShown, setHasShown] = useState(false);

  const showPopup = useCallback(() => {
    if (hasShown) return;
    if (isSubscribed()) return;
    if (isPopupDismissed()) return;

    setIsOpen(true);
    setHasShown(true);
  }, [hasShown]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    dismissPopup();
  }, []);

  const handleSuccess = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false);
    }, 2000);
  }, []);

  // Timer-based popup
  useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(showPopup, delay);
      return () => clearTimeout(timer);
    }
  }, [delay, showPopup]);

  // Exit intent detection (desktop only)
  useEffect(() => {
    if (!showOnExitIntent) return;

    const handleMouseLeave = (e: MouseEvent) => {
      // Check if mouse is leaving through the top of the page
      if (e.clientY <= 0) {
        showPopup();
      }
    };

    document.addEventListener('mouseleave', handleMouseLeave);
    return () => document.removeEventListener('mouseleave', handleMouseLeave);
  }, [showOnExitIntent, showPopup]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-card rounded-xl shadow-2xl border border-border animate-in fade-in zoom-in duration-300">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="p-8">
          {/* Icon */}
          <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>

          <NewsletterSignup
            source="popup"
            variant="stacked"
            showTitle
            showDescription
            title="Stay in the Loop!"
            description="Subscribe to get exclusive deals, new product updates, and insider tips delivered to your inbox."
            buttonText="Get Updates"
            placeholder="Enter your email"
            onSuccess={handleSuccess}
          />

          {/* Skip link */}
          <button
            onClick={handleClose}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block"
          >
            No thanks, maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
