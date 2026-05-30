/**
 * READ-ONLY. Audit existing products against the category→attribute rules.
 * Flags products carrying an attribute dimension their category shouldn't have
 * (e.g. a toy with FLAVOR, a lube with LENGTH) — likely mis-imported data.
 */
import { getConnection } from './lib/db';
import { isDimAllowed, type AttrDim } from './lib/attribute-rules';

const TAX_DIM: Record<string, AttrDim> = { pa_color: 'color', pa_size: 'apparel', pa_volume: 'volume', pa_length: 'length', pa_flavor: 'flavor', pa_material: 'material', pa_pack: 'count' };

async function main() {
  const db = await getConnection();
  // product -> its pa_* taxonomies (from term relationships) + categories
  const [rows] = await db.query<any[]>(
    `SELECT r.object_id pid, tt.taxonomy
       FROM wp_term_relationships r JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id
       JOIN wp_posts p ON p.ID=r.object_id AND p.post_type='product'
      WHERE tt.taxonomy IN ('pa_color','pa_size','pa_volume','pa_length','pa_flavor','pa_material','pa_pack')`);
  const prodTax = new Map<number, Set<string>>();
  for (const r of rows as any[]) (prodTax.get(r.pid) || prodTax.set(r.pid, new Set()).get(r.pid)!).add(r.taxonomy);

  const [cats] = await db.query<any[]>(
    `SELECT r.object_id pid, t.slug FROM wp_term_relationships r JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=r.term_taxonomy_id AND tt.taxonomy='product_cat' JOIN wp_terms t ON t.term_id=tt.term_id`);
  const prodCats = new Map<number, string[]>();
  for (const r of cats as any[]) (prodCats.get(r.pid) || prodCats.set(r.pid, []).get(r.pid)!).push(r.slug);

  // tally violations by (dim) and capture samples
  const violations: Record<string, { count: number; samples: number[] }> = {};
  for (const [pid, taxes] of prodTax) {
    const catSlugs = prodCats.get(pid) || [];
    for (const tax of taxes) {
      const dim = TAX_DIM[tax]; if (!dim) continue;
      if (!isDimAllowed(dim, catSlugs)) {
        const key = `${dim} on [${catSlugs[0] || 'no-cat'}]`;
        const v = violations[key] ||= { count: 0, samples: [] };
        v.count++; if (v.samples.length < 5) v.samples.push(pid);
      }
    }
  }

  // group by dim for headline
  const byDim: Record<string, number> = {};
  for (const [key, v] of Object.entries(violations)) { const dim = key.split(' ')[0]; byDim[dim] = (byDim[dim] || 0) + v.count; }
  console.log('=== VIOLATIONS by dimension (attribute on a category that should not have it) ===');
  for (const [d, n] of Object.entries(byDim).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(10)} ${n} products`);

  console.log('\n=== top violation buckets (dim on category) ===');
  for (const [key, v] of Object.entries(violations).sort((a, b) => b[1].count - a[1].count).slice(0, 25))
    console.log(`  ${String(v.count).padStart(4)}  ${key}  e.g. ${v.samples.join(',')}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
