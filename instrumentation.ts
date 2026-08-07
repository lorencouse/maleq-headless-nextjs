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

    // Warming every product wrote ~30GB of ISR cache per deploy (35K pages ×
    // html/rsc/meta) — the Aug 2026 disk incidents. Slugs are popularity-sorted,
    // so capping keeps the pages that actually get traffic; the long tail
    // renders on demand (~1s first hit). WARM_PRODUCT_LIMIT=-1 restores "all".
    const productLimit = Number(process.env.WARM_PRODUCT_LIMIT ?? 2000);

    setTimeout(async () => {
      try {
        const { startWarming } = await import('@/lib/utils/cache-warmer');
        const result = startWarming({
          concurrency: 5,
          delayMs: 100,
          ...(productLimit >= 0 ? { maxPerType: { product: productLimit } } : {}),
        });
        console.log(`[instrumentation] Cache warming: ${result.message}`);
      } catch (err) {
        console.error('[instrumentation] Failed to start cache warming:', err);
      }
    }, STARTUP_DELAY_MS);
  }
}
