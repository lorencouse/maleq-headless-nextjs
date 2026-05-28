/**
 * Probe: list all lube-related posts (linked + unlinked) across all languages
 * so we can manually verify the right EN ↔ ES pairings.
 */
import { getConnection } from './lib/db';
import { ROOT_LANGUAGE_SLUGS, detectGuideLocale } from '../lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

async function main() {
  const db = await getConnection();
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');
  const [rows] = await db.query<
    (RowDataPacket & {
      ID: number;
      post_title: string;
      post_name: string;
      lang_slug: string;
      translations_meta: string | null;
    })[]
  >(
    `SELECT p.ID, p.post_title, p.post_name,
            MAX(t.slug) AS lang_slug,
            MAX(pm.meta_value) AS translations_meta
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
       LEFT JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_maleq_translations'
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
        AND (LOWER(p.post_name) LIKE '%lube%'
          OR LOWER(p.post_name) LIKE '%lubricant%'
          OR LOWER(p.post_title) LIKE '%lube%'
          OR LOWER(p.post_title) LIKE '%lubricant%'
          OR LOWER(p.post_title) LIKE '%润滑%'
          OR LOWER(p.post_title) LIKE '%潤滑%')
      GROUP BY p.ID
      ORDER BY lang_slug, p.ID`,
    ROOT_LANGUAGE_SLUGS,
  );

  const byLang: Record<string, typeof rows> = {};
  for (const r of rows) {
    const locale = detectGuideLocale([r.lang_slug]) ?? r.lang_slug;
    (byLang[locale] ??= []).push(r);
  }

  for (const [loc, list] of Object.entries(byLang)) {
    console.log(`\n=== ${loc} (${list.length}) ===`);
    for (const r of list) {
      const linkedTo = r.translations_meta || '∅';
      console.log(`  #${String(r.ID).padStart(3)}  [${linkedTo.padEnd(12)}]  ${r.post_title.slice(0, 70)}`);
      console.log(`        slug: ${r.post_name}`);
    }
  }
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
