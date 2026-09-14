/**
 * CLAUDE.md rule, enforced: "Any code that creates or publishes a product MUST pass it
 * through lib/import/restricted-products.ts first." This scans every script for an
 * INSERT into wp_posts whose post_type literal is 'product' (parents only — variations
 * inherit their parent's verdict) and fails if that file never imports the gate.
 *
 * If you add a new product-creating script, wire in checkRestrictedProduct() /
 * partitionRestricted() rather than adding an exception here.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['scripts', 'lib'].map((d) => join(process.cwd(), d));
const SKIP = [/\/archive\//, /\/node_modules\//, /\.d\.ts$/, /\/restricted-products\.ts$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (SKIP.some((re) => re.test(p + (statSync(p).isDirectory() ? '/' : '')))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(p);
  }
  return out;
}

/** An INSERT into wp_posts that sets post_type to the literal 'product'. */
function insertsProductRows(src: string): boolean {
  const re = /INSERT\s+INTO\s+wp_posts\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const stmt = src.slice(m.index, m.index + 2500);
    if (/['"`]product['"`]/.test(stmt) && !/post_type\s*=\s*['"]product['"]\s+AND/i.test(stmt)) return true;
  }
  return false;
}

describe('product-creating scripts use the restricted-products gate', () => {
  const files = ROOTS.flatMap((r) => walk(r));
  const creators = files.filter((f) => insertsProductRows(readFileSync(f, 'utf-8')));

  it('finds the known importer (sanity check that the scan works)', () => {
    expect(creators.map((f) => relative(process.cwd(), f))).toContain('scripts/import-products-direct.ts');
  });

  it.each(creators.map((f) => [relative(process.cwd(), f)]))('%s imports lib/import/restricted-products', (rel) => {
    const src = readFileSync(join(process.cwd(), rel), 'utf-8');
    expect(src).toMatch(/from\s+['"][^'"]*restricted-products['"]/);
  });
});
