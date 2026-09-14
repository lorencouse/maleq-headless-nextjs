/**
 * The WordPress guard (wordpress/mu-plugins/maleq-restricted-products-guard.php) reads a
 * JSON export of the TypeScript rules. These tests keep the two sides honest:
 *   1. the JSON on disk is what `bun scripts/gen-restricted-rules.ts` would write now;
 *   2. every pattern stays PCRE-compatible (no lookbehind, named groups, \u{…}, s/y flags);
 *   3. when a PHP binary is available, the PHP port returns the same verdict as the
 *      TypeScript checker for a spread of restricted and allowed products.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import {
  buildSerializedRestrictedRules,
  checkRestrictedProduct,
  loadRestrictedAllowlist,
  SERIALIZED_RULES_PATH,
  type RestrictedCheckInput,
} from '../../lib/import/restricted-products';

const PLUGIN = join(process.cwd(), 'wordpress', 'mu-plugins', 'maleq-restricted-products-guard.php');
const HARNESS = join(__dirname, 'fixtures', 'restricted-guard-harness.php');

/** Prefer a PATH php; fall back to the Local-by-Flywheel bundle on this Mac. */
function findPhp(): string | null {
  const which = spawnSync('sh', ['-c', 'command -v php'], { encoding: 'utf-8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const services = join(process.env.HOME ?? '', 'Library', 'Application Support', 'Local', 'lightning-services');
  if (!existsSync(services)) return null;
  const candidates = readdirSync(services)
    .filter((d) => d.startsWith('php-'))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const binDir = join(services, dir, 'bin');
    if (!existsSync(binDir)) continue;
    for (const plat of readdirSync(binDir)) {
      const php = join(binDir, plat, 'bin', 'php');
      if (existsSync(php)) return php;
    }
  }
  return null;
}

const CASES: RestrictedCheckInput[] = [
  // restricted
  { name: 'CBD Daily Intensive Cream', brand: 'Earthly Body' },
  { name: 'Kush Queen Watermelon Female Gummies Delta 8' },
  { name: 'THC Game' },
  { name: 'Relaxing Massage & Body Oil', description: '<p>Infused with 1000&nbsp;mg of hemp-based CBD.</p>' },
  { name: 'Candle 3 in 1 Snow Angel 6 Candle', brand: 'Assorted CBD Vendors' },
  { name: 'Kush Bath Bomb Relax', description: '<p>Lavender bath bomb infused with cannabinoids.</p>' },
  { name: 'Mochi Magic Mushroom Vape Ice Mint 6pack Display' },
  { name: 'Cool Mint Nicotine Pouches 20ct' },
  { name: 'Amanita Muscaria Gummies 5ct' },
  { name: 'Stoner Besties One Hitter Kard' },
  { name: 'Rush Black' },
  { name: 'Jungle Juice Max 30ml' },
  { name: 'X Stream Fetish Urine 3 oz', description: 'Synthetic urine with heating pad.' },
  { name: 'The Whizzinator Touch!' },
  { name: 'Rhino 7 Male Enhancement Pills 24ct', categories: ['Supplements'] },
  { name: 'Glass Water Pipe 12in', categories: ['Smoke Shop'] },
  // allowed
  { name: 'Bong Thong Black L/XL' },
  { name: 'Cherry Poppers Lace Babydoll' },
  { name: 'Vaporator Vibrating Silicone Rechargeable Vape' },
  { name: 'Magic Mushroom Wand Massager' },
  { name: 'Tantus Amsterdam Dildo' },
  { name: 'Sugar Rush Bullet Vibe' },
  { name: 'Hemp Seed Massage Candle', description: 'THC-free, 0% CBD, hemp seed oil only.' },
  { name: '12 Panel Drug Test Cup', description: 'Tests for THC, cocaine and opiates.' },
  { name: 'Stash Cockring w/ Capsule Insert' },
  { name: 'Red Tobacco Massage Candle' },
  { name: 'Rize the Pill Mini Stroker' },
  { name: 'Water-Based Lube 8 oz', brand: 'Sliquid', categories: ['Lubricants'] },
];

describe('restricted rules export', () => {
  const onDisk = readFileSync(SERIALIZED_RULES_PATH, 'utf-8');
  const expected = JSON.stringify(buildSerializedRestrictedRules(), null, 2) + '\n';

  it('wordpress/mu-plugins/maleq-restricted-rules.json matches the TypeScript rules (run: bun scripts/gen-restricted-rules.ts)', () => {
    expect(onDisk).toBe(expected);
  });

  it('every pattern is PCRE-compatible', () => {
    const json = buildSerializedRestrictedRules();
    const regexes = [
      ...json.negatedClaims,
      ...json.rules.map((r) => r.pattern),
      ...json.rules.flatMap((r) => (r.unless ? [r.unless] : [])),
    ];
    for (const { source, flags } of regexes) {
      expect(source).not.toMatch(/\(\?<[=!]/); // lookbehind
      expect(source).not.toMatch(/\(\?<[a-zA-Z]/); // named groups
      expect(source).not.toMatch(/\\u\{|\\p\{/); // unicode escapes need the u flag
      expect(source).not.toContain('~'); // our PCRE delimiter
      expect(flags.replace(/[gi]/g, '')).toBe('');
    }
  });

  it('cases cover both verdicts', () => {
    const verdicts = CASES.map((c) => checkRestrictedProduct(c, { allowlist: loadRestrictedAllowlist() }).restricted);
    expect(verdicts.filter(Boolean).length).toBeGreaterThanOrEqual(14);
    expect(verdicts.filter((v) => !v).length).toBeGreaterThanOrEqual(10);
  });
});

describe('PHP guard parity', () => {
  const php = findPhp();
  const maybe = php ? it : it.skip;

  maybe('maleq_rpg_check() agrees with checkRestrictedProduct() on every case', () => {
    const run = spawnSync(php as string, [HARNESS, PLUGIN], {
      input: JSON.stringify(CASES),
      encoding: 'utf-8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout) as { results: Array<string | null>; errors: string[] };
    expect(out.errors).toEqual([]);

    const allowlist = loadRestrictedAllowlist();
    const expected = CASES.map((c) => {
      const r = checkRestrictedProduct(c, { allowlist });
      return r.restricted ? r.category : null;
    });
    const mismatches = CASES.map((c, i) => ({ name: c.name, ts: expected[i], php: out.results[i] })).filter(
      (m) => m.ts !== m.php,
    );
    expect(mismatches).toEqual([]);
  });

  maybe('the plugin file passes php -l', () => {
    const lint = spawnSync(php as string, ['-l', PLUGIN], { encoding: 'utf-8' });
    expect(lint.stdout).toContain('No syntax errors');
  });
});
