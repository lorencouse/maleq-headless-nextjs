/**
 * Bump year references in /guides blog posts (post_type='post') from
 * 2020–2025 → 2026, for SEO freshness ("Best X of 2025" → "...of 2026").
 *
 * TITLES: every standalone 2020–2025 token is replaced.
 *
 * CONTENT: bumps ONLY localized "current-year" listicle markers — Spanish
 * "de/del YYYY" and Chinese "YYYY年" — leaving every other year intact:
 * historical dates, citations, awards, events, /uploads/YYYY/ image & video
 * paths, link href/src URLs, and product shortcode id/sku/ids. Verified against
 * prod: this matches exactly the 4 stale listicle years and none of the ~982
 * image paths or the 8 genuine historical references.
 * Reusable-block (wp_block) content is NOT touched (shared across posts).
 *
 * Usage (DB target via scripts/lib/db.ts — REMOTE/prod by default):
 *   bun run scripts/refresh-post-years.ts                 # dry-run, remote
 *   bun run scripts/refresh-post-years.ts --local         # dry-run, local
 *   bun run scripts/refresh-post-years.ts --titles-only   # ignore content
 *   bun run scripts/refresh-post-years.ts --write --yes    # persist to PROD
 */
import type { RowDataPacket } from 'mysql2';
import { getConnection } from './lib/db';

const argv = process.argv;
const WRITE = argv.includes('--write');
const YES = argv.includes('--yes');
const IS_LOCAL = argv.includes('--local') || process.env.MYSQL_LOCAL === '1';
const TITLES_ONLY = argv.includes('--titles-only');

const TARGET = '2026';
const YEAR_RE = /\b(2020|2021|2022|2023|2024|2025)\b/g;

/** Title: bump every standalone year. */
function bumpTitle(title: string): { out: string; changed: boolean } {
  const out = title.replace(YEAR_RE, TARGET);
  return { out, changed: out !== title };
}

/**
 * Content: bump ONLY localized "current-year" listicle markers, leaving every
 * other year (historical dates, citations, awards, events, image paths, URLs,
 * IDs) untouched. The two markers seen in this content:
 *   - Spanish:  "de 2023" / "del 2022"   → de/del 2026
 *   - Chinese:  "2021年"                  → 2026年
 * These patterns don't occur in upload paths/URLs/shortcodes, so no chunk
 * masking is needed. A broad "all visible prose" pass was rejected because it
 * rewrites factual references (e.g. "2020 US Census", "September 30, 2020").
 */
function bumpContent(content: string): { out: string; hits: string[] } {
  const hits: string[] = [];
  const ctx = (s: string, i: number, len: number) =>
    s.slice(Math.max(0, i - 22), i + len + 12).replace(/\s+/g, ' ').trim();

  // Spanish: de/del <year>
  let out = content.replace(
    /\b(de|del)(\s+)(2020|2021|2022|2023|2024|2025)\b/gi,
    (_m, prep: string, sp: string, year: string, offset: number) => {
      hits.push(`${prep} ${year} → «…${ctx(content, offset, _m.length)}…»`);
      return `${prep}${sp}${TARGET}`;
    },
  );
  // Chinese: <year>年
  out = out.replace(
    /(2020|2021|2022|2023|2024|2025)(?=年)/g,
    (_m, _year: string, offset: number) => {
      hits.push(`${_m}年 → «…${ctx(out, offset, _m.length)}…»`);
      return TARGET;
    },
  );
  return { out, hits };
}

async function main() {
  if (WRITE && !IS_LOCAL && !YES) {
    console.error('\n⛔ Refusing to write to PROD without --yes (take a backup first per CLAUDE.md), then re-run with --write --yes.\n');
    process.exit(1);
  }

  const db = await getConnection();
  console.log(`${WRITE ? '✍️  WRITE' : '🔍 DRY-RUN'}  titlesOnly=${TITLES_ONLY}\n`);

  const [posts] = await db.query<(RowDataPacket & { ID: number; post_title: string; post_content: string })[]>(
    `SELECT ID, post_title, post_content
       FROM wp_posts
      WHERE post_type = 'post' AND post_status = 'publish'
        AND (post_title REGEXP '202[0-5]' OR post_content REGEXP '202[0-5]')
      ORDER BY post_date DESC`,
  );

  let titlesChanged = 0, contentChanged = 0, contentHitTotal = 0;
  const allContentHits: string[] = [];

  for (const post of posts) {
    const t = bumpTitle(post.post_title);
    const c = TITLES_ONLY ? { out: post.post_content, hits: [] as string[] } : bumpContent(post.post_content);

    if (!t.changed && c.hits.length === 0) continue;

    console.log(`#${post.ID}`);
    if (t.changed) {
      titlesChanged++;
      console.log(`   TITLE: "${post.post_title}"\n       → "${t.out}"`);
    }
    if (c.hits.length > 0) {
      contentChanged++;
      contentHitTotal += c.hits.length;
      for (const h of c.hits) {
        console.log(`   CONTENT: ${h}`);
        allContentHits.push(h);
      }
    }

    if (WRITE && (t.changed || c.hits.length > 0)) {
      await db.query(`UPDATE wp_posts SET post_title = ?, post_content = ? WHERE ID = ?`, [t.out, c.out, post.ID]);
    }
  }

  console.log(
    `\n📊 posts scanned=${posts.length}  titles ${WRITE ? 'changed' : 'to change'}=${titlesChanged}  ` +
    `content posts=${contentChanged}  content prose-year hits=${contentHitTotal}`,
  );
  if (!WRITE) console.log('   (dry-run — review the CONTENT lines above, then re-run with --write --yes)');

  await db.end();
}

main().catch((err) => {
  console.error('refresh-post-years failed:', err);
  process.exit(1);
});
