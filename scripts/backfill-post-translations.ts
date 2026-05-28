/**
 * Backfill guide translation links (`_maleq_translations`).
 *
 * The site once ran WPML; its translation-mapping table is gone, so the
 * original↔translation pairings have to be reconstructed. This script proposes
 * them from signals that translations tend to share, even though they're
 * otherwise independent posts:
 *
 *   1. Featured-image base filename  — WPML duplicated images, but the
 *      duplicates keep the same base name (sized/`-N` suffixes stripped).
 *   2. Embedded-video oembed hash    — translations reuse the same video embed.
 *   3. Distinctive shared title tokens (years, brand/product names, latin
 *      loanwords) — used only as corroboration / weak suggestions, never alone.
 *
 * Posts are clustered (union-find) over the STRONG signals (1 & 2), restricted
 * to edges between DIFFERENT languages (language = root category, see
 * lib/i18n/guide-languages.ts). Clean clusters — ≤1 post per language and ≥2
 * languages — become auto-apply candidates. Clusters with same-language
 * collisions are flagged for human review. Title-token-only cross-language
 * pairs are emitted as a separate "weak suggestions" list, not applied.
 *
 * Output (always written):  scripts/output/translation-proposals.json
 *
 * Usage:
 *   bun run scripts/backfill-post-translations.ts --local            # dry-run, propose only
 *   bun run scripts/backfill-post-translations.ts --local --apply    # write meta to LOCAL db
 *
 * Safety: --apply refuses to run against the remote/production DB unless you
 * pass --force-remote (and you must take a DB backup first — see CLAUDE.md).
 * After applying, run `wp cache flush` so WordPress's object cache (Redis)
 * doesn't keep serving stale post-meta in the editor.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnection } from './lib/db';
import {
  detectGuideLocale,
  GUIDE_LANGUAGES,
  localeOrder,
  ROOT_LANGUAGE_SLUGS,
  type GuideLocale,
} from '../lib/i18n/guide-languages';

const APPLY = process.argv.includes('--apply');
const FORCE_REMOTE = process.argv.includes('--force-remote');
const IS_LOCAL = process.argv.includes('--local') || process.env.MYSQL_LOCAL === '1';

const TRANSLATIONS_META = '_maleq_translations';
const OUT_DIR = join(import.meta.dir, 'output');
const OUT_FILE = join(OUT_DIR, 'translation-proposals.json');

// Generic words that don't distinguish posts; excluded from title-token signal.
const STOPWORDS = new Set([
  'best', 'guide', 'guides', 'your', 'with', 'that', 'this', 'from', 'what',
  'when', 'where', 'which', 'about', 'have', 'will', 'they', 'their', 'gay',
  'lgbtq', 'lgbt', 'maleq', 'male', 'mejores', 'como', 'para', 'sexo', 'sexual',
  'sexuales', 'tips', 'guia', 'guía', 'top', 'the', 'and', 'for', 'you',
]);

interface PostRow {
  id: number;
  title: string;
  slug: string;
  locale: GuideLocale | undefined;
  imageBase: string | null;
  oembed: Set<string>;
  tokens: Set<string>;
}

/** Distinctive title tokens: years/numbers (≥2 digits) and latin words (≥4 chars). */
function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  const lower = title.toLowerCase();
  for (const m of lower.matchAll(/[a-z]{4,}|\d{2,}/g)) {
    const tok = m[0];
    if (!STOPWORDS.has(tok)) out.add(tok);
  }
  return out;
}

async function main() {
  if (APPLY && !IS_LOCAL && !FORCE_REMOTE) {
    console.error(
      '\n✋ Refusing to --apply against the remote/production DB.\n' +
        '   Run with --local to write to your Local by Flywheel DB, or, only after\n' +
        '   taking a fresh production backup (see CLAUDE.md "Database Backup Policy"),\n' +
        '   re-run with --force-remote.\n',
    );
    process.exit(1);
  }

  const db = await getConnection();

  // ── Load posts + language + featured-image base filename ──
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');
  const [postRows]: any = await db.query(
    `SELECT p.ID,
            ANY_VALUE(p.post_title) AS title,
            ANY_VALUE(p.post_name)  AS slug,
            MAX(t.slug)             AS lang_slug,
            ANY_VALUE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(SUBSTRING_INDEX(att.meta_value, '/', -1), '-[0-9]+x[0-9]+', ''),
                '-[0-9]+\\.', '.')
            ) AS image_base
       FROM wp_posts p
       LEFT JOIN wp_term_relationships tr ON tr.object_id = p.ID
       LEFT JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       LEFT JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
       LEFT JOIN wp_postmeta tm ON tm.post_id = p.ID AND tm.meta_key = '_thumbnail_id'
       LEFT JOIN wp_postmeta att ON att.post_id = tm.meta_value AND att.meta_key = '_wp_attached_file'
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
      GROUP BY p.ID`,
    ROOT_LANGUAGE_SLUGS,
  );

  // ── Load oembed hashes (one embedded resource each) per post ──
  const [oembedRows]: any = await db.query(
    `SELECT pm.post_id, pm.meta_key
       FROM wp_postmeta pm
       JOIN wp_posts p ON p.ID = pm.post_id
      WHERE pm.meta_key LIKE '\\_oembed\\_%' AND pm.meta_key NOT LIKE '%time%'
        AND p.post_type = 'post' AND p.post_status = 'publish'`,
  );
  const oembedByPost = new Map<number, Set<string>>();
  for (const r of oembedRows) {
    const set = oembedByPost.get(r.post_id) ?? new Set<string>();
    set.add(r.meta_key);
    oembedByPost.set(r.post_id, set);
  }

  const posts: PostRow[] = postRows.map((r: any) => ({
    id: r.ID,
    title: r.title,
    slug: r.slug,
    locale: r.lang_slug ? detectGuideLocale([r.lang_slug]) : undefined,
    imageBase: r.image_base || null,
    oembed: oembedByPost.get(r.ID) ?? new Set<string>(),
    tokens: titleTokens(r.title || ''),
  }));
  const byId = new Map(posts.map((p) => [p.id, p]));

  // ── Document frequency for tokens (to keep only distinctive ones) ──
  const df = new Map<string, number>();
  for (const p of posts) for (const tok of p.tokens) df.set(tok, (df.get(tok) ?? 0) + 1);
  const DISTINCTIVE_MAX_DF = 6;

  // ── Build STRONG cross-language edges (image base / oembed) ──
  const byImage = new Map<string, number[]>();
  const byOembed = new Map<string, number[]>();
  const pushTo = (map: Map<string, number[]>, key: string, id: number) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const p of posts) {
    if (p.imageBase) pushTo(byImage, p.imageBase, p.id);
    for (const h of p.oembed) pushTo(byOembed, h, p.id);
  }

  type Edge = { a: number; b: number; reasons: string[] };
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const edges = new Map<string, Edge>();
  const addEdge = (a: number, b: number, reason: string) => {
    const pa = byId.get(a), pb = byId.get(b);
    if (!pa || !pb) return;
    if (!pa.locale || !pb.locale || pa.locale === pb.locale) return; // cross-language only
    const k = edgeKey(a, b);
    const e = edges.get(k) ?? { a, b, reasons: [] };
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    edges.set(k, e);
  };
  for (const ids of byImage.values())
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
      addEdge(ids[i], ids[j], `image:${byId.get(ids[i])!.imageBase}`);
  for (const [hash, ids] of byOembed)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
      addEdge(ids[i], ids[j], `oembed:${hash.replace('_oembed_', '')}`);

  // ── Union-find clustering over strong edges ──
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) { const n = parent.get(x)!; parent.set(x, root); x = n; }
    return root;
  };
  const union = (a: number, b: number) => { parent.set(find(a), find(b)); };
  for (const e of edges.values()) union(e.a, e.b);

  const clusters = new Map<number, Set<number>>();
  for (const e of edges.values()) {
    const root = find(e.a);
    const set = clusters.get(root) ?? new Set<number>();
    set.add(e.a); set.add(e.b);
    clusters.set(root, set);
  }

  // ── Classify clusters ──
  interface Member { id: number; locale: GuideLocale; title: string; slug: string; }
  interface Proposal {
    members: Member[];
    languages: GuideLocale[];
    reasons: string[];
    status: 'auto-apply' | 'needs-review';
    note?: string;
  }
  const proposals: Proposal[] = [];

  for (const set of clusters.values()) {
    const ids = [...set];
    const members: Member[] = ids
      .map((id) => byId.get(id)!)
      .filter((p) => p.locale)
      .map((p) => ({ id: p.id, locale: p.locale!, title: p.title, slug: p.slug }))
      .sort((m1, m2) => localeOrder(m1.locale) - localeOrder(m2.locale));

    const reasons = [...new Set(ids.flatMap((id) => {
      const r: string[] = [];
      for (const e of edges.values()) if (e.a === id || e.b === id) r.push(...e.reasons);
      return r;
    }))];

    const langCounts = new Map<GuideLocale, number>();
    for (const m of members) langCounts.set(m.locale, (langCounts.get(m.locale) ?? 0) + 1);
    const languages = [...langCounts.keys()].sort((a, b) => localeOrder(a) - localeOrder(b));
    const hasCollision = [...langCounts.values()].some((c) => c > 1);

    proposals.push({
      members,
      languages,
      reasons,
      status: hasCollision || languages.length < 2 ? 'needs-review' : 'auto-apply',
      note: hasCollision ? 'Multiple posts share a language — pick the right one before applying.' : undefined,
    });
  }
  proposals.sort((a, b) => a.status.localeCompare(b.status) || b.members.length - a.members.length);

  // ── Weak suggestions: cross-language pairs with ≥2 distinctive shared tokens
  //    and no strong edge (review only) ──
  const weak: { a: Member; b: Member; sharedTokens: string[] }[] = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      const pa = posts[i], pb = posts[j];
      if (!pa.locale || !pb.locale || pa.locale === pb.locale) continue;
      if (edges.has(edgeKey(pa.id, pb.id))) continue;
      const shared = [...pa.tokens].filter(
        (t) => pb.tokens.has(t) && (df.get(t) ?? 0) <= DISTINCTIVE_MAX_DF,
      );
      if (shared.length >= 2) {
        weak.push({
          a: { id: pa.id, locale: pa.locale, title: pa.title, slug: pa.slug },
          b: { id: pb.id, locale: pb.locale, title: pb.title, slug: pb.slug },
          sharedTokens: shared,
        });
      }
    }
  }
  weak.sort((x, y) => y.sharedTokens.length - x.sharedTokens.length);

  // ── Report ──
  const autoApply = proposals.filter((p) => p.status === 'auto-apply');
  const needsReview = proposals.filter((p) => p.status === 'needs-review');

  console.log('\n══ Guide translation backfill ' + (APPLY ? '(APPLY)' : '(dry-run)') + ' ══');
  console.log(`Posts scanned: ${posts.length}  (by language: ${GUIDE_LANGUAGES.map(
    (l) => `${l.locale}=${posts.filter((p) => p.locale === l.locale).length}`,
  ).join(', ')})`);
  console.log(`Strong cross-language edges: ${edges.size}`);
  console.log(`Clusters → auto-apply: ${autoApply.length}, needs-review: ${needsReview.length}`);
  console.log(`Weak token-only suggestions: ${weak.length}`);

  console.log('\n── Auto-apply candidates ──');
  for (const p of autoApply) {
    console.log(
      `  [${p.languages.join('+')}] ` +
        p.members.map((m) => `${m.locale}#${m.id} "${m.title.slice(0, 40)}"`).join('  ↔  ') +
        `   (${p.reasons.slice(0, 2).join(', ')})`,
    );
  }
  if (needsReview.length) {
    console.log('\n── Needs review (same-language collisions) ──');
    for (const p of needsReview) {
      console.log(
        `  ${p.members.map((m) => `${m.locale}#${m.id} "${m.title.slice(0, 36)}"`).join('  ↔  ')} — ${p.note}`,
      );
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), proposals, weak }, null, 2));
  console.log(`\n📄 Full proposals written to ${OUT_FILE}`);

  // ── Apply ──
  if (APPLY) {
    let groupsWritten = 0;
    for (const p of autoApply) {
      const ids = p.members.map((m) => m.id);
      for (const id of ids) {
        const siblings = ids.filter((x) => x !== id);
        await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [id, TRANSLATIONS_META]);
        if (siblings.length) {
          await db.query(
            `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
            [id, TRANSLATIONS_META, siblings.join(',')],
          );
        }
      }
      groupsWritten++;
    }
    console.log(`\n✅ Applied ${groupsWritten} auto-apply translation group(s) to ${IS_LOCAL ? 'LOCAL' : 'REMOTE'} db.`);
    console.log('   ⚠️  Run `wp cache flush` so the WP object cache (Redis) reloads the new meta.');
    console.log('   ℹ️  needs-review clusters and weak suggestions were NOT applied — link those via the editor meta box.');
  } else {
    console.log('\nDry-run only. Re-run with --apply (and --local) to write the auto-apply groups.');
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
