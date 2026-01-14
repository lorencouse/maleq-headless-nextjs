/**
 * Utility to check if stock needs refreshing and trigger update
 * This is called from page components to ensure fresh stock data
 */

const STOCK_REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const lastStockUpdateKey = 'last-stock-update';

// In-memory cache for server-side tracking (resets on server restart)
let lastUpdateTime: number | null = null;

/**
 * Check if stock needs updating based on last update time
 */
export function shouldUpdateStock(): boolean {
  if (!lastUpdateTime) {
    return true;
  }

  const now = Date.now();
  return now - lastUpdateTime >= STOCK_REFRESH_INTERVAL;
}

/**
 * Trigger stock update via API (non-blocking)
 * This should be called from page components when rendering
 */
export async function triggerStockUpdate(): Promise<void> {
  if (!shouldUpdateStock()) {
    console.log('Stock was recently updated, skipping...');
    return;
  }

  console.log('Triggering background stock update...');
  lastUpdateTime = Date.now();

  // Trigger update in background without waiting
  // Use the site URL or relative path
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  fetch(`${baseUrl}/api/admin/sync/stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }).catch((error) => {
    console.error('Failed to trigger stock update:', error);
    // Reset lastUpdateTime on failure so it tries again next time
    lastUpdateTime = null;
  });
}

/**
 * Force stock update (waits for completion)
 * Use this when you need to ensure stock is updated before continuing
 */
export async function forceStockUpdate(): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/admin/sync/stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.success) {
      lastUpdateTime = Date.now();
      return { success: true };
    } else {
      return { success: false, error: data.error };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Reset update tracking (useful for testing)
 */
export function resetUpdateTracking(): void {
  lastUpdateTime = null;
}
