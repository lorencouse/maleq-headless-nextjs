/**
 * Stock Alert Utility
 *
 * Manages stock alert subscriptions for out-of-stock products
 * In production, integrate with email service or notification system
 */

const STORAGE_KEY = 'maleq-stock-alerts';

export interface StockAlert {
  productId: string;
  productName: string;
  email: string;
  subscribedAt: string;
}

/**
 * Get all stock alerts for the current user
 */
export function getStockAlerts(): StockAlert[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    return JSON.parse(saved);
  } catch {
    return [];
  }
}

/**
 * Check if user is subscribed to alerts for a product
 */
export function isSubscribedToAlert(productId: string): boolean {
  const alerts = getStockAlerts();
  return alerts.some((alert) => alert.productId === productId);
}

/**
 * Get the email used for stock alert subscription
 */
export function getAlertEmail(productId: string): string | null {
  const alerts = getStockAlerts();
  const alert = alerts.find((a) => a.productId === productId);
  return alert?.email || null;
}

/**
 * Add a stock alert subscription (client-side tracking)
 */
export function addStockAlert(alert: Omit<StockAlert, 'subscribedAt'>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getStockAlerts();

    // Remove existing alert for this product
    const filtered = current.filter((a) => a.productId !== alert.productId);

    const newAlert: StockAlert = {
      ...alert,
      subscribedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify([...filtered, newAlert]));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Remove a stock alert subscription
 */
export function removeStockAlert(productId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getStockAlerts();
    const filtered = current.filter((a) => a.productId !== productId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear all stock alerts
 */
export function clearStockAlerts(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
