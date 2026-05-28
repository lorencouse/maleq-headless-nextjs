/**
 * Populate `_maleq_related_product_cats` on /guides posts (post_type='post')
 * based on each post's TITLE and its existing BLOG CATEGORIES.
 *
 * Matching is a curated, multilingual (EN/ES/CN) keyword → product_cat map.
 * It runs against the TITLE plus only *product-specific* blog categories
 * (Lubricantes, Anillos Para el Pene). Topical blog categories (Anal Sex / 肛交,
 * Sex, How to, etc.) are intentionally excluded: they're applied to editorial
 * and travel posts too (e.g. "Gay Cities of the World" is tagged 肛交), so using
 * them as a signal produces false positives. Titles reliably name the product
 * type in every language. Each entry maps product-type language to a specific
 * product_cat slug; entries are most-specific first and we keep the top 3.
 *
 * Stores an ordered CSV of product_cat term IDs (same format the meta box writes
 * and lib/db/post-relations.ts reads).
 *
 * Usage (DB target via scripts/lib/db.ts — REMOTE/prod by default):
 *   bun run scripts/backfill-post-product-cats.ts                 # dry-run, remote
 *   bun run scripts/backfill-post-product-cats.ts --local         # dry-run, local
 *   bun run scripts/backfill-post-product-cats.ts --write --yes    # persist to PROD
 *
 * Flags: --write (persist), --yes (required for prod write), --overwrite
 *        (replace existing), --limit N (testing).
 */
import type { RowDataPacket } from 'mysql2';
import { getConnection } from './lib/db';

const META = '_maleq_related_product_cats';
const MAX_CATS = 3;

/**
 * Only product-specific blog categories contribute to matching (in addition to
 * the title). Topical/editorial categories (Anal Sex, 肛交, Sex, How to, …) are
 * excluded because they're applied to non-product posts too.
 */
const BLOG_CAT_ALLOW = /lubricante|anillo|情趣用品|juguetes sexuales/i;

const argv = process.argv;
const WRITE = argv.includes('--write');
const YES = argv.includes('--yes');
const OVERWRITE = argv.includes('--overwrite');
const IS_LOCAL = argv.includes('--local') || process.env.MYSQL_LOCAL === '1';
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i !== -1 && argv[i + 1] ? parseInt(argv[i + 1], 10) : undefined;
})();

/**
 * Curated keyword → product_cat slug map. Most-specific first.
 * Latin keywords are matched on word boundaries; CJK keywords as substrings.
 */
const MAP: { slug: string; kw: string[] }[] = [
  { slug: 'anal-lubes-lotions-sprays-creams', kw: ['anal lube', 'anal lubes', 'lubricante anal', 'lubricantes anales'] },
  { slug: 'glass-dildos-dongs', kw: ['glass dildo', 'glass dildos', 'glass dong', 'dildo de vidrio'] },
  { slug: 'lubricants', kw: ['lube', 'lubes', 'lubricant', 'lubricants', 'lubricante', 'lubricantes', '潤滑', '润滑'] },
  { slug: 'masturbation-sleeves', kw: ['masturbation sleeve', 'stroker sleeve'] },
  { slug: 'masturbators', kw: ['masturbator', 'masturbators', 'stroker', 'strokers', 'fleshlight', 'fleshlights', 'masturbador', 'masturbadores', '飛機杯', '自慰套'] },
  { slug: 'glass-vibrators', kw: ['glass vibrator', 'glass vibrators'] },
  { slug: 'g-spot', kw: ['g-spot', 'g spot', 'punto g'] },
  { slug: 'prostate-massagers-p-spot-stimulators', kw: ['prostate', 'p-spot', 'p spot', 'próstata', 'prostata', '前列腺', '攝護腺'] },
  { slug: 'vibrators', kw: ['vibrator', 'vibrators', 'vibrador', 'vibradores', '按摩棒', '震動棒', '跳蛋'] },
  { slug: 'penis-pumps', kw: ['penis pump', 'penis pumps', 'male pump', 'bomba de pene', '陰莖幫浦', '陰莖泵'] },
  { slug: 'anal-beads', kw: ['anal bead', 'anal beads', 'bolas anales', 'bolas chinas', '肛門珠', '後庭拉珠'] },
  { slug: 'small-medium-butt-plugs', kw: ['butt plug', 'butt plugs', 'tapón anal', 'tapones anales', 'plug anal', '肛塞', '後庭塞'] },
  { slug: 'dildos-dongs', kw: ['dildo', 'dildos', 'dong', 'dongs', 'consolador', 'consoladores', '假屌', '假陽具'] },
  { slug: 'strap-ons-harnesses', kw: ['strap-on', 'strap on', 'strapon', 'strap-ons', 'pegging', 'arnés', 'correa con dildo', '穿戴'] },
  { slug: 'sex-dolls', kw: ['sex doll', 'sex dolls', 'muñeca sexual', 'muñecas sexuales', '性愛娃娃', '充氣娃娃'] },
  { slug: 'cock-rings', kw: ['cock ring', 'cock rings', 'penis ring', 'love ring', 'anillo', 'anillos', 'anillo para el pene', 'anillos para el pene', '套環', '屌環', '陰莖環'] },
  { slug: 'condoms', kw: ['condom', 'condoms', 'condón', 'condon', 'condones', '保險套', '保险套', '安全套'] },
  { slug: 'anal-douches-enemas-hygiene', kw: ['enema', 'enemas', 'douche', 'douches', 'lavativa', 'lavativas', 'lavado anal', '灌腸'] },
  { slug: 'toy-cleaner', kw: ['toy cleaner', 'clean your sex toy', 'limpiador de juguetes'] },
  { slug: 'kegel-balls', kw: ['kegel', 'bolas kegel', '凱格爾'] },
  { slug: 'penis-sleeves-french-ticklers', kw: ['penis sleeve', 'funda para el pene'] },
  { slug: 'penis-extensions', kw: ['penis extension', 'penis extender', 'extensión de pene', 'larger cock', 'dick look bigger'] },
  { slug: 'nipple-play', kw: ['nipple', 'pezón', 'pezones', '乳頭'] },
  { slug: 'magic-wands-body-massagers', kw: ['magic wand', 'wand massager'] },
  { slug: 'mens-cock-ball-gear', kw: ['chastity', 'cock cage', 'chastity cage', 'jaula de castidad', '貞操'] },
  { slug: 'anal-toys', kw: ['anal', 'sexo anal', '肛交', '後庭'] },
  // Audience fallbacks (lowest priority — only fill remaining slots)
  { slug: 'sextoys-for-men', kw: ['for men', 'male sex toy', 'male sex toys', 'masculinos', 'para hombres', 'juguetes gay', '男性', '男用'] },
  { slug: 'sextoys-for-women', kw: ['for women', 'female sex toy', 'para mujeres', '女性', '女用'] },
];

const CJK_RE = /[　-鿿가-힯]/;

/** Minimal HTML entity decode for the bits that appear in titles / term names. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&#0?34;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;|&mdash;/gi, '-');
}

/** Does `text` contain `kw` as a word (Latin) or substring (CJK)? */
function hasKeyword(text: string, kw: string): boolean {
  if (CJK_RE.test(kw)) return text.includes(kw);
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`).test(text);
}

/** Return product-cat slugs matched by the text, in priority order, deduped. */
function matchCategorySlugs(text: string): string[] {
  const out: string[] = [];
  for (const entry of MAP) {
    if (out.includes(entry.slug)) continue;
    if (entry.kw.some((k) => hasKeyword(text, k))) out.push(entry.slug);
  }
  return out;
}

async function main() {
  if (WRITE && !IS_LOCAL && !YES) {
    console.error('\n⛔ Refusing to write to PROD without --yes (take a backup first per CLAUDE.md), then re-run with --write --yes.\n');
    process.exit(1);
  }

  const db = await getConnection();
  console.log(`${WRITE ? '✍️  WRITE' : '🔍 DRY-RUN'}  overwrite=${OVERWRITE}\n`);

  // Product categories → slug → {term_id, name}
  const [catRows] = await db.query<(RowDataPacket & { term_id: number; name: string; slug: string })[]>(
    `SELECT t.term_id, t.name, t.slug FROM wp_terms t
       JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
      WHERE tt.taxonomy = 'product_cat'`,
  );
  const catBySlug = new Map<string, { term_id: number; name: string }>();
  for (const c of catRows) catBySlug.set(c.slug, { term_id: c.term_id, name: decodeEntities(c.name) });

  // Validate the map's target slugs exist
  const missing = [...new Set(MAP.map((m) => m.slug))].filter((s) => !catBySlug.has(s));
  if (missing.length) console.log(`⚠️  map slugs not found in product_cat (skipped): ${missing.join(', ')}\n`);

  // Posts + their blog category names
  const limitClause = LIMIT ? ` LIMIT ${LIMIT}` : '';
  const [posts] = await db.query<(RowDataPacket & { ID: number; post_title: string })[]>(
    `SELECT ID, post_title FROM wp_posts
      WHERE post_type = 'post' AND post_status = 'publish'
      ORDER BY post_date DESC${limitClause}`,
  );
  const postIds = posts.map((p) => p.ID);

  const blogCatsByPost = new Map<number, string[]>();
  if (postIds.length) {
    const [rels] = await db.query<(RowDataPacket & { object_id: number; name: string })[]>(
      `SELECT tr.object_id, t.name
         FROM wp_term_relationships tr
         JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
         JOIN wp_terms t ON t.term_id = tt.term_id
        WHERE tt.taxonomy = 'category' AND tr.object_id IN (?)`,
      [postIds],
    );
    for (const r of rels) {
      const list = blogCatsByPost.get(r.object_id) || [];
      list.push(r.name);
      blogCatsByPost.set(r.object_id, list);
    }
  }

  // Existing meta (skip unless --overwrite)
  const existing = new Set<number>();
  if (postIds.length) {
    const [metaRows] = await db.query<(RowDataPacket & { post_id: number })[]>(
      `SELECT post_id FROM wp_postmeta WHERE meta_key = ? AND post_id IN (?) AND meta_value <> ''`,
      [META, postIds],
    );
    for (const m of metaRows) existing.add(m.post_id);
  }

  let matched = 0, written = 0, skipped = 0, noMatch = 0;

  for (const post of posts) {
    const blogCats = blogCatsByPost.get(post.ID) || [];
    const productCats = blogCats.filter((c) => BLOG_CAT_ALLOW.test(decodeEntities(c)));
    const text = decodeEntities(`${post.post_title} ${productCats.join(' ')}`).toLowerCase();
    const slugs = matchCategorySlugs(text)
      .filter((s) => catBySlug.has(s))
      .slice(0, MAX_CATS);

    if (slugs.length === 0) { noMatch++; continue; }
    matched++;

    if (existing.has(post.ID) && !OVERWRITE) {
      skipped++;
      continue;
    }

    const termIds = slugs.map((s) => catBySlug.get(s)!.term_id);
    const names = slugs.map((s) => catBySlug.get(s)!.name);
    console.log(`${WRITE ? '✅' : '•'} #${post.ID} "${post.post_title}"  [blog: ${blogCats.join(', ') || '—'}]`);
    console.log(`     → ${names.join(' | ')}  (${termIds.join(',')})`);

    if (WRITE) {
      await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [post.ID, META]);
      await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [post.ID, META, termIds.join(',')]);
      written++;
    }
  }

  console.log(
    `\n📊 posts=${posts.length}  matched=${matched}  no-match=${noMatch}  ` +
    `${WRITE ? `written=${written}` : `would-write=${matched - skipped}`}  skipped(existing)=${skipped}`,
  );
  if (!WRITE) console.log('   (dry-run — review the category assignments above, then re-run with --write --yes)');

  await db.end();
}

main().catch((err) => {
  console.error('backfill-post-product-cats failed:', err);
  process.exit(1);
});
