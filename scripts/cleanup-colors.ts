/**
 * Clean up pa_color attribute terms based on scripts/color-cleanup-map.generated.json.
 *
 *   COLOR  -> repoint product->pa_color relationships to canonical base color term(s)
 *   MOVE   -> move product relationship to a pa_size / pa_flavor term (reuse or create)
 *   DELETE -> detach product relationships, remove term
 * Plus: consolidate single-color synonym slugs on product_variation `attribute_pa_color`
 *       postmeta (collision-guarded). Composites keep their combined value as one option.
 *
 * Touches ONLY: wp_term_relationships, wp_term_taxonomy, wp_terms, wp_termmeta,
 *               and product_variation `attribute_pa_color` postmeta.
 * Does NOT touch `_product_attributes` blobs (ignored for taxonomy attrs by the headless FE).
 *
 * Usage:
 *   bun run scripts/cleanup-colors.ts --local --dry-run   # preview (no writes)
 *   bun run scripts/cleanup-colors.ts --local             # apply on local
 *   bun run scripts/cleanup-colors.ts --dry-run           # preview against prod (tunnel)
 */
import { getConnection } from './lib/db';
import map from './color-cleanup-map.generated.json';

type Mapping = {
  term_id: number; name: string; slug: string; products: number; variations: number;
  action: 'KEEP' | 'COLOR' | 'MOVE' | 'DELETE';
  colors?: string[]; taxonomy?: string; value?: string; variationValue?: string; note?: string;
};

const DRY = process.argv.includes('--dry-run');
const mappings = map as Mapping[];

// slugify the same way WP does (lowercase, non-alnum -> hyphen)
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function main() {
  const db = await getConnection();
  await db.query('SET autocommit=0');
  await db.query('START TRANSACTION');

  const stats = {
    colorTermsRepointed: 0, relsRepointed: 0, relsInserted: 0,
    moveTerms: 0, relsMoved: 0,
    deleteTerms: 0, relsDetached: 0,
    termsRemoved: 0,
    varRewritten: 0, varSkippedCollision: 0,
  };

  // ---- helper: term_taxonomy_id for a given (taxonomy, slug); create term if missing ----
  const ttCache = new Map<string, { termId: number; ttId: number }>();
  async function ensureTerm(taxonomy: string, slug: string, name: string): Promise<{ termId: number; ttId: number }> {
    const key = `${taxonomy}:${slug}`;
    if (ttCache.has(key)) return ttCache.get(key)!;
    const [rows] = await db.query<any[]>(
      `SELECT t.term_id, tt.term_taxonomy_id AS ttId
       FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id=t.term_id
       WHERE tt.taxonomy=? AND t.slug=? LIMIT 1`, [taxonomy, slug]);
    if ((rows as any[]).length) {
      const r = (rows as any[])[0];
      const out = { termId: r.term_id, ttId: r.ttId };
      ttCache.set(key, out); return out;
    }
    // create
    if (DRY) { const out = { termId: -1, ttId: -1 }; ttCache.set(key, out); return out; }
    const [ins] = await db.query<any>(`INSERT INTO wp_terms (name, slug, term_group) VALUES (?,?,0)`, [name, slug]);
    const termId = ins.insertId;
    const [ins2] = await db.query<any>(
      `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?,?,'',0,0)`,
      [termId, taxonomy]);
    const out = { termId, ttId: ins2.insertId };
    ttCache.set(key, out); return out;
  }

  // Protected canonical pa_color term_ids (base colors) — never delete these.
  const baseSlugs = new Set<string>();
  for (const m of mappings) if (m.colors) m.colors.forEach((c) => baseSlugs.add(c));
  const baseTT = new Map<string, { termId: number; ttId: number }>();
  for (const slug of baseSlugs) {
    baseTT.set(slug, await ensureTerm('pa_color', slug, slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())));
  }
  const protectedTermIds = new Set<number>([...baseTT.values()].map((v) => v.termId));
  // also protect KEEP terms
  for (const m of mappings) if (m.action === 'KEEP') protectedTermIds.add(m.term_id);

  // source term -> its current pa_color term_taxonomy_id
  async function sourceTT(termId: number): Promise<number | null> {
    const [r] = await db.query<any[]>(
      `SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id=? AND taxonomy='pa_color' LIMIT 1`, [termId]);
    return (r as any[]).length ? (r as any[])[0].term_taxonomy_id : null;
  }

  // ============ PHASE A: relationships ============
  for (const m of mappings) {
    if (m.action === 'KEEP') continue;
    if (protectedTermIds.has(m.term_id)) continue; // a base/keep term, leave it
    const srcTT = await sourceTT(m.term_id);
    if (srcTT == null) continue;

    if (m.action === 'COLOR') {
      stats.colorTermsRepointed++;
      for (const c of m.colors!) {
        const tgt = baseTT.get(c)!;
        if (tgt.termId === m.term_id) continue; // self
        if (!DRY) {
          const [ins] = await db.query<any>(
            `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
             SELECT object_id, ?, 0 FROM wp_term_relationships WHERE term_taxonomy_id=?`,
            [tgt.ttId, srcTT]);
          stats.relsInserted += ins.affectedRows || 0;
        }
      }
      if (!DRY) {
        const [del] = await db.query<any>(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=?`, [srcTT]);
        stats.relsRepointed += del.affectedRows || 0;
      } else { stats.relsRepointed += m.products; }
    } else if (m.action === 'MOVE') {
      stats.moveTerms++;
      const tax = m.taxonomy || 'pa_size';
      const tslug = slugify(m.value || m.name);
      const tgt = await ensureTerm(tax, tslug, (m.value || m.name).trim());
      if (!DRY) {
        const [ins] = await db.query<any>(
          `INSERT IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
           SELECT object_id, ?, 0 FROM wp_term_relationships WHERE term_taxonomy_id=?`, [tgt.ttId, srcTT]);
        const [del] = await db.query<any>(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=?`, [srcTT]);
        stats.relsMoved += del.affectedRows || 0;
      } else { stats.relsMoved += m.products; }
    } else if (m.action === 'DELETE') {
      stats.deleteTerms++;
      if (!DRY) {
        const [del] = await db.query<any>(`DELETE FROM wp_term_relationships WHERE term_taxonomy_id=?`, [srcTT]);
        stats.relsDetached += del.affectedRows || 0;
      } else { stats.relsDetached += m.products; }
    }
  }

  // ============ PHASE B: variation postmeta consolidation (single-color synonyms only) ============
  // For each COLOR mapping with exactly one base color and a different slug, retarget the
  // variation attribute_pa_color slug -> base slug, unless a sibling variation of the same
  // parent already uses the base slug (would collide / duplicate the option).
  for (const m of mappings) {
    if (m.action !== 'COLOR' || !m.colors || m.colors.length !== 1) continue;
    const base = m.colors[0];
    if (m.slug === base) continue;
    const [vars] = await db.query<any[]>(
      `SELECT pm.meta_id, pm.post_id, p.post_parent
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID=pm.post_id AND p.post_type='product_variation'
       WHERE pm.meta_key='attribute_pa_color' AND pm.meta_value=?`, [m.slug]);
    for (const v of vars as any[]) {
      // sibling already on base?
      const [sib] = await db.query<any[]>(
        `SELECT 1 FROM wp_postmeta pm JOIN wp_posts p ON p.ID=pm.post_id
         WHERE p.post_parent=? AND p.post_type='product_variation'
           AND pm.meta_key='attribute_pa_color' AND pm.meta_value=? AND pm.post_id<>? LIMIT 1`,
        [v.post_parent, base, v.post_id]);
      if ((sib as any[]).length) { stats.varSkippedCollision++; continue; }
      if (!DRY) {
        await db.query(`UPDATE wp_postmeta SET meta_value=? WHERE meta_id=?`, [base, v.meta_id]);
      }
      stats.varRewritten++;
    }
  }

  // ============ PHASE C: delete emptied source terms ============
  for (const m of mappings) {
    if (m.action === 'KEEP') continue;
    if (protectedTermIds.has(m.term_id)) continue;
    if (!DRY) {
      await db.query(`DELETE FROM wp_term_taxonomy WHERE term_id=? AND taxonomy='pa_color'`, [m.term_id]);
      await db.query(`DELETE FROM wp_termmeta WHERE term_id=?`, [m.term_id]);
      // delete the term row only if it now has no term_taxonomy rows at all
      const [tt] = await db.query<any[]>(`SELECT 1 FROM wp_term_taxonomy WHERE term_id=? LIMIT 1`, [m.term_id]);
      if (!(tt as any[]).length) await db.query(`DELETE FROM wp_terms WHERE term_id=?`, [m.term_id]);
    }
    stats.termsRemoved++;
  }

  // ============ recount ============
  if (!DRY) {
    await db.query(
      `UPDATE wp_term_taxonomy tt
       SET count=(SELECT COUNT(*) FROM wp_term_relationships tr WHERE tr.term_taxonomy_id=tt.term_taxonomy_id)
       WHERE tt.taxonomy IN ('pa_color','pa_size','pa_flavor')`);
  }

  // ============ report ============
  const [finalColors] = await db.query<any[]>(
    `SELECT COUNT(*) AS n FROM wp_term_taxonomy WHERE taxonomy='pa_color'`);
  console.log(`\n${DRY ? '[DRY-RUN] ' : ''}=== Color cleanup summary ===`);
  console.table(stats);
  console.log(`pa_color terms ${DRY ? 'currently' : 'now'}: ${finalColors[0].n}  (was ${mappings.length})`);

  if (DRY) {
    await db.query('ROLLBACK');
    console.log('\nDRY-RUN: rolled back, no changes written.');
  } else {
    await db.query('COMMIT');
    console.log('\nCOMMITTED.');
  }
  await db.end();
}
main().catch(async (e) => { console.error(e); process.exit(1); });
