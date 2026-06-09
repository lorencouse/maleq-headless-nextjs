import { getConnection } from './lib/db';

// classify a pa_size term name into an axis
function classify(name: string): { kind: string; detail?: string } {
  const n = name.trim().toLowerCase();
  if (!n) return { kind: 'empty' };
  // volume: oz / ml / fl oz / liter / g
  if (/\b\d+(\.\d+)?\s*(fl\.?\s*oz|fluid\s*ounce)/.test(n)) return { kind: 'volume', detail: 'floz' };
  if (/\b\d+(\.\d+)?\s*ml\b/.test(n)) return { kind: 'volume', detail: 'ml' };
  if (/\b\d+(\.\d+)?\s*(l|liter|litre)\b/.test(n)) return { kind: 'volume', detail: 'L' };
  if (/\b\d+(\.\d+)?\s*oz\b/.test(n)) return { kind: 'volume', detail: 'oz' };
  if (/\b\d+(\.\d+)?\s*(g|gram|grams|gm)\b/.test(n)) return { kind: 'weight', detail: 'g' };
  // length: in / inch / " / cm / mm / ft
  if (/\b\d+(\.\d+)?\s*(in|inch|inches|")\b/.test(n) || /\d"\s*$/.test(n)) return { kind: 'length', detail: 'in' };
  if (/\b\d+(\.\d+)?\s*cm\b/.test(n)) return { kind: 'length', detail: 'cm' };
  if (/\b\d+(\.\d+)?\s*mm\b/.test(n)) return { kind: 'length', detail: 'mm' };
  if (/\b\d+(\.\d+)?\s*(ft|foot|feet)\b/.test(n)) return { kind: 'length', detail: 'ft' };
  // count / pack
  if (/\b\d+\s*(pcs?|pc|pack|pk|count|ct|dozen|display|piece)/.test(n) || /\bdisplay\b/.test(n)) return { kind: 'count' };
  // apparel size tokens
  if (/^(x{0,3}s|x{0,4}l|m|s|l|2xl|3xl|4xl|5xl|1xl|os|qs|one\s*size|queen|plus|petite|small|medium|large|x-?large|x-?small)([\/\s-]+(x{0,3}s|x{0,4}l|m|s|l|2xl|3xl|4xl|os|qs|small|medium|large))*$/i.test(n)) return { kind: 'apparel' };
  // bare number (ambiguous: could be length-in or apparel size)
  if (/^\d+(\.\d+)?$/.test(n)) return { kind: 'bare-number', detail: n };
  if (/^\d+(\.\d+)?\s*(in\.)?\s*\w/.test(n) && /\b(pink|black|blue|red|white|clear|flesh|purple|beige|tan|with balls|balls)\b/.test(n)) return { kind: 'length+other', detail: 'in' };
  return { kind: 'other' };
}

async function main() {
  const db = await getConnection();
  const [rows] = await db.query<any[]>(
    `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id ttid,
        (SELECT COUNT(*) FROM wp_term_relationships r WHERE r.term_taxonomy_id=tt.term_taxonomy_id) AS products
     FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id=tt.term_id
     WHERE tt.taxonomy='pa_size' ORDER BY products DESC, t.name`);
  const buckets: Record<string, { terms: number; products: number; samples: string[] }> = {};
  for (const r of rows as any[]) {
    const c = classify(r.name);
    const key = c.detail ? `${c.kind}:${c.detail}` : c.kind;
    const b = buckets[key] ||= { terms: 0, products: 0, samples: [] };
    b.terms++; b.products += Number(r.products);
    if (b.samples.length < 14) b.samples.push(`${r.name}(${r.products})`);
  }
  console.log(`TOTAL pa_size terms: ${rows.length}\n`);
  const order = Object.entries(buckets).sort((a, b) => b[1].terms - a[1].terms);
  for (const [k, v] of order) {
    console.log(`${k.padEnd(18)} terms=${String(v.terms).padStart(4)}  product-rels=${String(v.products).padStart(5)}`);
    console.log(`   e.g. ${v.samples.join(', ')}`);
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
