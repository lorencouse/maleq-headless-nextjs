/**
 * Toast Notification Component
 *
 * Wrapper for react-hot-toast with custom styling
 */

'use client';

import { Toaster as HotToaster } from 'react-hot-toast';

export function Toaster() {
  return (
    <HotToaster
      position="top-right"
      reverseOrder={false}
      gutter={8}
      containerStyle={{
        // Prevent browser extensions (Dark Reader etc.) from adding background
        background: 'transparent',
        backgroundColor: 'transparent',
      }}
      toastOptions={{
        // Default options
        duration: 4000,
        style: {
          background: 'var(--toast-bg)',
          color: 'var(--toast-color)',
          border: '1px solid var(--toast-border)',
          padding: '16px',
          borderRadius: '8px',
          fontSize: '14px',
        },
        // Success
        success: {
          duration: 3000,
          iconTheme: {
            primary: '#10B981',
            secondary: '#ffffff',
          },
        },
        // Error
        error: {
          duration: 5000,
          iconTheme: {
            primary: '#EF4444',
            secondary: '#ffffff',
          },
        },
        // Loading
        loading: {
          iconTheme: {
            primary: '#3B82F6',
            secondary: '#ffffff',
          },
        },
      }}
    />
  );
}
