import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared test fixtures for the UAT smoke suite.
 *
 * These tests run against the live, Cloudflare-fronted production site. When
 * Cloudflare serves its "bot challenge" interstitial instead of the app, the
 * page still contains an <h1> and other generic elements, so naive assertions
 * can pass against the challenge page or fail with a misleading "element not
 * found". This fixture wraps `page.goto` to detect the challenge and fail with
 * an explicit, actionable message instead.
 *
 * The proper fix is the `UAT_BYPASS_SECRET` header (see playwright.config.ts +
 * the Cloudflare WAF skip rule); this guard is the safety net for when that
 * header is missing or the rule is misconfigured.
 */

const CHALLENGE_MARKERS = [
  'Performing security verification',
  'Verify you are human',
  'Just a moment',
  'Checking your browser',
];

async function assertNotChallenged(page: Page, url: string): Promise<void> {
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page
      .locator('body')
      .innerText({ timeout: 2000 })
      .catch(() => ''),
  ]);

  const haystack = `${title}\n${bodyText}`;
  const hit = CHALLENGE_MARKERS.find((marker) => haystack.includes(marker));

  if (hit) {
    throw new Error(
      `Cloudflare bot challenge intercepted navigation to "${url}" (matched: "${hit}"). ` +
        `The UAT_BYPASS_SECRET header is missing or the Cloudflare WAF "skip managed ` +
        `challenge" rule is not active. See playwright.config.ts and .github/workflows/uat-smoke.yml.`
    );
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);

    page.goto = (async (url: string, options?: Parameters<typeof originalGoto>[1]) => {
      const response = await originalGoto(url, options);
      await assertNotChallenged(page, url);
      return response;
    }) as typeof page.goto;

    await use(page);
  },
});

export { expect, type Page };
