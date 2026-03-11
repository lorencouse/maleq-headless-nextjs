/**
 * Toast Notification Component
 *
 * Wrapper for react-hot-toast with custom styling
 */

'use client';

import toast, { ToastBar, Toaster as HotToaster } from 'react-hot-toast';

export function Toaster() {
  return (
    <HotToaster
      position="top-right"
      reverseOrder={false}
      gutter={8}
      containerStyle={{
        // Offset below sticky navbar (h-16 = 64px + padding)
        top: 72,
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
    >
      {(t) => (
        <div
          className="cursor-pointer"
          onClick={() => toast.dismiss(t.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              toast.dismiss(t.id);
            }
          }}
        >
          <ToastBar toast={t} />
        </div>
      )}
    </HotToaster>
  );
}
