// Sentry initialization for error monitoring
// To enable: npm install @sentry/nextjs
// Then add NEXT_PUBLIC_SENTRY_DSN to .env

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

interface SentryConfig {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  debug: boolean;
  enabled: boolean;
}

export const sentryConfig: SentryConfig = {
  dsn: SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  debug: process.env.NODE_ENV === 'development',
  enabled: !!SENTRY_DSN && process.env.NODE_ENV === 'production',
};

// Error reporting utility
export function reportError(error: Error, context?: Record<string, unknown>): void {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', error);
    if (context) {
      console.error('Context:', context);
    }
    return;
  }

  // In production, you would send to Sentry
  // This is a placeholder for when Sentry is installed
  // Sentry.captureException(error, { extra: context });

  // For now, log to console
  console.error('[Production Error]', error, context);
}

// Breadcrumb utility for tracking user actions
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${category}] ${message}`, data);
    return;
  }

  // When Sentry is installed:
  // Sentry.addBreadcrumb({
  //   category,
  //   message,
  //   data,
  //   level,
  // });
}

// User identification for error tracking
export function setUser(user: { id: string; email?: string; name?: string } | null): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Sentry] Set user:', user);
    return;
  }

  // When Sentry is installed:
  // Sentry.setUser(user);
}

// Tag errors with additional context
export function setTag(key: string, value: string): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Sentry] Set tag: ${key}=${value}`);
    return;
  }

  // When Sentry is installed:
  // Sentry.setTag(key, value);
}
