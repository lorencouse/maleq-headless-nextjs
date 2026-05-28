/**
 * Discover EN ↔ ES/ZH translation candidates that the original backfill
 * script's strong-signal pass missed.
 *
 * The original auto-apply pass requires identical featured-image base filename
 * OR identical video oembed hash. That works for photography posts where the
 * translation reuses the same image, but lube/product reviews use a different
 * featured image per language — so they get no signal. This script adds
 * several softer signals and SCORES candidates rather than clustering them,
 * which is the right shape when each foreign-language post almost always has
 * exactly one English counterpart.
 *
 * Signals (each contributes to a per-candidate score):
 *
 *   1. Slug brand-token overlap         — strongest soft signal. Each post's
 *      slug is split into tokens (after stripping locale-specific noise like
 *      'resena-de'); brand/product tokens that appear in both sides are worth
 *      a lot.
 *   2. Featured-image base-name overlap — partial match on stripped filename.
 *   3. Title brand/product-token overlap
 *      — same idea but on titles.
 *   4. Shared WooCommerce `[product id=N]` shortcode references — translations
 *      of the same product review typically reference the same product(s).
 *   5. Shared external links              — translations often link to the
 *      same external retailer / brand pages.
 *
 * Output: scripts/output/translation-discovery.json
 *
 * Usage:
 *   bun run scripts/discover-translations.ts            # default: top-3 candidates per unlinked ES/ZH post
 *   bun run scripts/discover-translations.ts --topN=5
 *   bun run scripts/discover-translations.ts --min-score=8   # only emit candidates above threshold
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnection } from './lib/db';
import {
  detectGuideLocale,
  ROOT_LANGUAGE_SLUGS,
  type GuideLocale,
} from '../lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

const TRANSLATIONS_META = '_maleq_translations';
const TOP_N = parseInt(process.argv.find((a) => a.startsWith('--topN='))?.slice('--topN='.length) ?? '3', 10);
const MIN_SCORE = parseFloat(process.argv.find((a) => a.startsWith('--min-score='))?.slice('--min-score='.length) ?? '0');
const OUT_FILE = join(import.meta.dir, 'output', 'translation-discovery.json');

// Tokens that don't distinguish posts and shouldn't earn signal points.
// Mixed English + Spanish + Chinese stopwords.
const STOPWORDS = new Set([
  // EN
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'by', 'can', 'do', 'for',
  'from', 'gay', 'get', 'guide', 'guides', 'how', 'i', 'in', 'is', 'it', 'lgbt',
  'lgbtq', 'male', 'maleq', 'of', 'on', 'or', 'review', 'reviews',
  'sex', 'sexual', 'the', 'this', 'to', 'top', 'we', 'what', 'why', 'with', 'you',
  'your', 'amazing', 'update', 'new', 'product',
  // ES
  'al', 'algunos', 'amor', 'analizar', 'analizo', 'analyse',
  'analisis', 'análisis', 'anal', 'anales', 'asi', 'así', 'base', 'bien', 'bueno',
  'buen', 'buena', 'cada', 'cómo', 'como', 'con', 'consejo', 'consejos', 'cuál',
  'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'en', 'es',
  'esa', 'ese', 'esta', 'este', 'estos', 'estas', 'guia', 'guía', 'guías', 'guias',
  'gusta', 'hace', 'hay', 'la', 'las', 'lo', 'los',
  'mas', 'más', 'mejor', 'mejores', 'mi', 'mio', 'mu', 'muy', 'no', 'novia',
  'novio', 'novios', 'nuestra', 'nuestro', 'o', 'para', 'parecer', 'pero', 'por',
  'producto', 'pueden', 'puede', 'que', 'qué', 'quien', 'quién', 'reseña',
  'resena', 'reseñas', 'resenas', 'review', 'sexo', 'sexual', 'sexuales', 'si',
  'sin', 'sobre', 'solo', 'son', 'también', 'tambien', 'te', 'todo', 'todos',
  'tu', 'un', 'una', 'unos', 'unas', 'usar', 'usando', 'vamos', 'vale', 'venir',
  'ver', 'y', 'ya', 'yo',
  // ZH common particles handled separately (CJK tokens are short already)
  '的', '是', '在', '了', '和', '與', '与', '對', '对', '不', '我', '你', '他',
  // numeric noise
  '2022', '2023', '2024', '2025', '2026',
]);

interface Post {
  id: number;
  title: string;
  slug: string;
  locale: GuideLocale;
  image: string | null;       // base filename (stripped)
  content: string;            // post_content (truncated)
}

interface Candidate {
  id: number;
  locale: GuideLocale;
  title: string;
  slug: string;
  score: number;
  signals: Record<string, number>;
  detail: { tokens?: string[]; image?: string; productIds?: number[]; links?: string[] };
}

function stripImage(filename: string | null): string | null {
  if (!filename) return null;
  // Strip path, extension, size suffix (-300x200), -N retry suffixes (-1, -2),
  // and lowercase. WPML duplicates often have -1 / -2 / scaled variants.
  const base = filename.split('/').pop() || filename;
  return base
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-\d+x\d+$/, '')
    .replace(/-\d+$/, '')
    .replace(/-(scaled|edited)$/, '');
}

function tokenize(s: string): string[] {
  // Latin tokens (alphanumeric runs) + CJK character runs.
  const latinTokens = (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const cjkTokens = (s.match(/[一-鿿]+/g) ?? [])
    .filter((t) => t.length >= 2);
  return [...latinTokens, ...cjkTokens];
}

/** Extract `[product id="N"]` and `[product id=N]` shortcode IDs. */
function extractProductIds(content: string): number[] {
  const ids = new Set<number>();
  const re = /\[product[^\]]+id=["']?(\d+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return Array.from(ids);
}

/**
 * Extract distinctive outbound URLs from a post — hostnames + path tokens. We
 * keep brand-y external links (amazon product slug, manufacturer pages) and
 * skip the local domain.
 */
function extractExternalLinks(content: string): string[] {
  const links = new Set<string>();
  const re = /https?:\/\/([^/\s"'<>)]+)([^"'<>)\s]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const host = m[1].toLowerCase();
    if (host.includes('maleq.com') || host.includes('wp.maleq.com')) continue;
    // Keep host + first path segment as a stable identifier
    const firstSeg = (m[2] || '').split('/').filter(Boolean)[0] ?? '';
    links.add(`${host}/${firstSeg}`.replace(/\/$/, ''));
  }
  return Array.from(links);
}

async function loadPosts(db: Awaited<ReturnType<typeof getConnection>>): Promise<Post[]> {
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');
  const [rows] = await db.query<
    (RowDataPacket & {
      ID: number;
      post_title: string;
      post_name: string;
      post_content: string;
      lang_slug: string;
      image_filename: string | null;
    })[]
  >(
    `SELECT p.ID,
            p.post_title,
            p.post_name,
            SUBSTRING(p.post_content, 1, 8000) AS post_content,
            MAX(t.slug) AS lang_slug,
            (SELECT pm2.meta_value
               FROM wp_postmeta pm2
               JOIN wp_posts att ON att.ID = CAST(pm2.meta_value AS UNSIGNED)
               JOIN wp_postmeta pm3 ON pm3.post_id = att.ID AND pm3.meta_key = '_wp_attached_file'
              WHERE pm2.post_id = p.ID AND pm2.meta_key = '_thumbnail_id'
              LIMIT 1) AS thumbnail_id,
            (SELECT pm3.meta_value
               FROM wp_postmeta pm2
               JOIN wp_postmeta pm3 ON pm3.post_id = CAST(pm2.meta_value AS UNSIGNED) AND pm3.meta_key = '_wp_attached_file'
              WHERE pm2.post_id = p.ID AND pm2.meta_key = '_thumbnail_id'
              LIMIT 1) AS image_filename
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
      GROUP BY p.ID`,
    ROOT_LANGUAGE_SLUGS,
  );

  const out: Post[] = [];
  for (const r of rows) {
    const locale = detectGuideLocale([r.lang_slug]);
    if (!locale) continue;
    out.push({
      id: r.ID,
      title: r.post_title,
      slug: r.post_name,
      locale,
      image: stripImage(r.image_filename),
      content: r.post_content || '',
    });
  }
  return out;
}

async function loadLinkedIds(db: Awaited<ReturnType<typeof getConnection>>): Promise<Set<number>> {
  const [rows] = await db.query<(RowDataPacket & { post_id: number; meta_value: string })[]>(
    `SELECT post_id, meta_value FROM wp_postmeta
      WHERE meta_key = ? AND meta_value IS NOT NULL AND meta_value <> ''`,
    [TRANSLATIONS_META],
  );
  return new Set(rows.map((r) => r.post_id));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

async function main() {
  const db = await getConnection();
  const [posts, linked] = await Promise.all([loadPosts(db), loadLinkedIds(db)]);

  // Index posts by locale and pre-compute signal sets.
  type Indexed = Post & {
    slugTokens: Set<string>;
    titleTokens: Set<string>;
    productIds: Set<number>;
    externalLinks: Set<string>;
  };
  const byLocale: Record<GuideLocale, Indexed[]> = { en: [], es: [], zh: [], ja: [] };
  for (const p of posts) {
    const enriched: Indexed = {
      ...p,
      slugTokens: new Set(tokenize(p.slug.replace(/-/g, ' '))),
      titleTokens: new Set(tokenize(p.title)),
      productIds: new Set(extractProductIds(p.content)),
      externalLinks: new Set(extractExternalLinks(p.content)),
    };
    byLocale[p.locale].push(enriched);
  }

  console.log('\nCorpus:');
  for (const loc of Object.keys(byLocale) as GuideLocale[]) {
    console.log(`  ${loc}: ${byLocale[loc].length} posts`);
  }

  const proposals: {
    foreign: { id: number; locale: GuideLocale; title: string; slug: string; linked: boolean };
    candidates: Candidate[];
  }[] = [];

  // For each ES/ZH post — linked OR unlinked — score against all UNLINKED EN posts.
  // We DON'T skip already-linked-on-the-foreign-side: this discovery may
  // surface that a post is mis-linked. But we keep that flag in the output.
  for (const foreignLoc of ['es', 'zh'] as GuideLocale[]) {
    for (const foreign of byLocale[foreignLoc]) {
      if (linked.has(foreign.id)) continue; // skip already-linked foreign posts
      const cand: Candidate[] = [];
      for (const en of byLocale.en) {
        if (linked.has(en.id)) continue; // skip already-linked EN posts
        const signals: Record<string, number> = {};

        // 1. Slug-token overlap (heavily weighted; brand/product tokens common to both)
        const slugInter: string[] = [];
        for (const t of foreign.slugTokens) if (en.slugTokens.has(t)) slugInter.push(t);
        if (slugInter.length > 0) {
          // weight per-token, capped — single shared token of length≥4 = 4.0 pts
          signals.slug = slugInter.reduce((acc, t) => acc + Math.min(4, t.length), 0);
        }

        // 2. Featured image base-name (exact match — same image was carried over)
        if (foreign.image && en.image && foreign.image === en.image) {
          signals.image = 8;
        } else if (foreign.image && en.image) {
          // partial: shared 4+ char run inside the base
          const overlap = jaccard(new Set(foreign.image.split('-')), new Set(en.image.split('-')));
          if (overlap >= 0.4) signals.imagePartial = +(overlap * 4).toFixed(2);
        }

        // 3. Title-token overlap
        const titleInter: string[] = [];
        for (const t of foreign.titleTokens) if (en.titleTokens.has(t)) titleInter.push(t);
        if (titleInter.length > 0) {
          signals.title = titleInter.reduce((acc, t) => acc + Math.min(3, t.length * 0.8), 0);
        }

        // 4. Shared WooCommerce product references
        const productInter: number[] = [];
        for (const id of foreign.productIds) if (en.productIds.has(id)) productInter.push(id);
        if (productInter.length > 0) {
          signals.products = productInter.length * 4;
        }

        // 5. Shared external links (host/first-segment)
        const linkInter: string[] = [];
        for (const l of foreign.externalLinks) if (en.externalLinks.has(l)) linkInter.push(l);
        if (linkInter.length > 0) {
          signals.links = Math.min(6, linkInter.length * 1.5);
        }

        const score = Object.values(signals).reduce((a, b) => a + b, 0);
        if (score < MIN_SCORE) continue;
        cand.push({
          id: en.id,
          locale: en.locale,
          title: en.title,
          slug: en.slug,
          score: +score.toFixed(2),
          signals,
          detail: {
            tokens: slugInter.length ? slugInter : titleInter,
            image: signals.image ? foreign.image! : undefined,
            productIds: productInter.length ? productInter : undefined,
            links: linkInter.length ? linkInter.slice(0, 3) : undefined,
          },
        });
      }
      cand.sort((a, b) => b.score - a.score);
      if (cand.length === 0) continue;
      proposals.push({
        foreign: {
          id: foreign.id,
          locale: foreign.locale,
          title: foreign.title,
          slug: foreign.slug,
          linked: linked.has(foreign.id),
        },
        candidates: cand.slice(0, TOP_N),
      });
    }
  }

  // Summary
  console.log(`\nDiscovered ${proposals.length} foreign post(s) with candidates.`);
  const strong = proposals.filter((p) => p.candidates[0].score >= 10).length;
  const veryStrong = proposals.filter((p) => p.candidates[0].score >= 15).length;
  console.log(`  ≥10 score (likely match): ${strong}`);
  console.log(`  ≥15 score (very likely): ${veryStrong}`);

  console.log('\nTop 10 candidates (score-sorted):');
  const flat = proposals
    .map((p) => ({ score: p.candidates[0].score, p }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  for (const { p } of flat) {
    const top = p.candidates[0];
    console.log(
      `  [${p.foreign.locale}#${p.foreign.id} "${p.foreign.title.slice(0, 40)}"]  ↔  ` +
        `[en#${top.id} "${top.title.slice(0, 40)}"]  ` +
        `(score=${top.score}; ${Object.entries(top.signals).map(([k, v]) => `${k}=${v}`).join(', ')})`,
    );
  }

  mkdirSync(join(import.meta.dir, 'output'), { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        topN: TOP_N,
        minScore: MIN_SCORE,
        proposals,
      },
      null,
      2,
    ),
  );
  console.log(`\n📄 Full discovery written to ${OUT_FILE}`);
  console.log('   Review the top candidates and apply pairs you confirm via apply-weak-translations.ts');

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
