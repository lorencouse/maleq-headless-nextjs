/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the server starts. Used to auto-start cache warming
 * after deploy so ISR pages get pre-rendered without external triggers.
 *
 * Set AUTO_WARM_CACHE=true in your environment to enable.
 */
export async function onRequestError() {
  // Required export for instrumentation — no-op
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ISR_JANITOR !== 'false') {
    // Cap the ISR disk cache — it has no built-in eviction and filled the
    // 75GB host disk in Aug 2026. See lib/utils/isr-cache-janitor.ts.
    try {
      const { startIsrCacheJanitor } = await import('@/lib/utils/isr-cache-janitor');
      startIsrCacheJanitor();
    } catch (err) {
      console.error('[instrumentation] Failed to start ISR cache janitor:', err);
    }
  }

  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.AUTO_WARM_CACHE === 'true') {
    // Wait for the server to be fully ready before warming
    const STARTUP_DELAY_MS = 10_000;

    console.log(`[instrumentation] Auto-warm enabled — will start cache warming in ${STARTUP_DELAY_MS / 1000}s`);

    setTimeout(async () => {
      try {
        const { startWarming } = await import('@/lib/utils/cache-warmer');
        const result = startWarming({
          concurrency: 5,
          delayMs: 100,
        });
        console.log(`[instrumentation] Cache warming: ${result.message}`);
      } catch (err) {
        console.error('[instrumentation] Failed to start cache warming:', err);
      }
    }, STARTUP_DELAY_MS);
  }
}
