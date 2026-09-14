/**
 * Stripe compliance smoke — runs daily against production with the UAT suite.
 *
 * Stripe closed the account in Sep 2026 for "misleading information" and reinstated it
 * on 2026-09-14 after we (a) put the legal entity, 18+ notice and policy links in the
 * footer and (b) removed every CBD product. Both are now standing conditions, so this
 * spec fails the day either regresses on the live site.
 *
 * Product checks go through /api/search (fuzzy, so it also catches near-spellings) and
 * judge each returned title with the same rules the importers and the WordPress guard
 * use. Every category is ENFORCED since the 2026-09-14 purge (31 paraphernalia / poppers /
 * drug-test / THC items drafted). To stage a new category, take it out of ENFORCED and it
 * is reported as a warning instead of failing the run.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { test as guardedTest } from './fixtures';
import {
  checkRestrictedProduct,
  loadRestrictedAllowlist,
  type RestrictedCategory,
} from '../lib/import/restricted-products';

const ENFORCED: RestrictedCategory[] = [
  'cannabinoid',
  'vape-tobacco',
  'psychedelic',
  'drug-paraphernalia',
  'poppers',
  'drug-test-evasion',
  'supplement',
];

const QUERIES = [
  // cannabinoid
  'cbd', 'thc', 'delta 8', 'cannabinoid', 'hemp', 'kratom', 'kush',
  // vape / tobacco
  'vape', 'nicotine', 'e-liquid', 'cigarette',
  // psychedelic
  'amanita', 'mushroom gummies', 'microdose',
  // paraphernalia / poppers / drug-test / pills
  'one hitter', 'bong', 'grinder', 'rush', 'jungle juice', 'locker room', 'poppers',
  'whizzinator', 'synthetic urine', 'detox', 'enhancement pills',
];

const POLICY_PAGES = ['/terms', '/privacy', '/shipping-returns', '/contact'];

interface SearchHit { name: string; slug: string }

async function search(request: APIRequestContext, q: string): Promise<SearchHit[]> {
  const res = await request.get(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
  const type = res.headers()['content-type'] ?? '';
  if (!res.ok() || !type.includes('json')) {
    throw new Error(
      `/api/search?q=${q} returned ${res.status()} ${type || '(no content-type)'} — ` +
        `a Cloudflare challenge? Check UAT_BYPASS_SECRET (playwright.config.ts).`,
    );
  }
  const body = (await res.json()) as { products?: SearchHit[] };
  return body.products ?? [];
}

test.describe('Stripe compliance: catalog', () => {
  test('search never surfaces a Stripe-restricted product', async ({ request }, testInfo) => {
    const allowlist = loadRestrictedAllowlist();
    const seen = new Map<string, { name: string; category: RestrictedCategory; query: string }>();

    for (const q of QUERIES) {
      for (const p of await search(request, q)) {
        if (seen.has(p.slug)) continue;
        const r = checkRestrictedProduct({ name: p.name }, { allowlist });
        if (r.restricted && r.category) seen.set(p.slug, { name: p.name, category: r.category, query: q });
      }
    }

    const hits = [...seen.values()];
    const enforced = hits.filter((h) => ENFORCED.includes(h.category));
    const pending = hits.filter((h) => !ENFORCED.includes(h.category));

    for (const h of pending) {
      testInfo.annotations.push({
        type: 'warning',
        description: `still live (${h.category}): "${h.name}" — found via "${h.query}"`,
      });
    }
    if (pending.length) {
      console.warn(`[compliance] ${pending.length} restricted-but-undecided products still live:\n` +
        pending.map((h) => `  - ${h.category}: ${h.name}`).join('\n'));
    }

    expect(
      enforced.map((h) => `${h.category}: "${h.name}" (query "${h.query}")`),
      'Products in a category Stripe reinstated us on the condition we drop. Hide them: ' +
        'bun scripts/_audit-restricted-products.ts --apply (after scripts/ops/prod-backup.sh), ' +
        'then scripts/ops/revalidate-frontend.sh. False positive? data/restricted-allowlist.json.',
    ).toEqual([]);
  });
});

guardedTest.describe('Stripe compliance: business identity', () => {
  guardedTest('footer names the legal entity, the 18+ notice and the policy links', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/THE MALEQ LLC/i);
    await expect(footer).toContainText(/18\+/);
    await expect(footer.locator('a[href*="/terms"]').first()).toBeVisible();
    await expect(footer.locator('a[href*="/privacy"]').first()).toBeVisible();
    await expect(footer.locator('a[href*="/shipping-returns"]').first()).toBeVisible();
    // Email may be rewritten by Cloudflare obfuscation; the phone link is stable.
    await expect(footer.locator('a[href^="tel:"]').first()).toBeVisible();
  });

  for (const path of POLICY_PAGES) {
    guardedTest(`${path} is reachable`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status(), `${path} → ${res.status()}`).toBe(200);
      const html = await res.text();
      expect(html).not.toMatch(/Just a moment|Verify you are human/);
      if (path === '/terms') expect(html).toMatch(/18/);
    });
  }
});
