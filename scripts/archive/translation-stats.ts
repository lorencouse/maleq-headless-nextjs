/**
 * Quick stats probe: how many published posts per language, and how many
 * already have `_maleq_translations` meta set. Read-only.
 */
import { getConnection } from './lib/db';
import { ROOT_LANGUAGE_SLUGS } from '../lib/i18n/guide-languages';
import type { RowDataPacket } from 'mysql2';

async function main() {
  const db = await getConnection();
  const slugPlaceholders = ROOT_LANGUAGE_SLUGS.map(() => '?').join(',');

  const [rows] = await db.query<
    (RowDataPacket & {
      lang_slug: string;
      total: number;
      linked: number;
    })[]
  >(
    `SELECT t.slug AS lang_slug,
            COUNT(DISTINCT p.ID) AS total,
            COUNT(DISTINCT CASE WHEN pm.meta_value IS NOT NULL AND pm.meta_value <> '' THEN p.ID END) AS linked
       FROM wp_posts p
       JOIN wp_term_relationships tr ON tr.object_id = p.ID
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
       JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug IN (${slugPlaceholders})
       LEFT JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_maleq_translations'
      WHERE p.post_type = 'post' AND p.post_status = 'publish'
      GROUP BY t.slug
      ORDER BY total DESC`,
    ROOT_LANGUAGE_SLUGS,
  );

  console.log('\nPosts per language (published) and translation-link coverage:');
  console.log('  lang_slug             total   linked   unlinked');
  console.log('  --------------------  -----   ------   --------');
  for (const r of rows) {
    const unlinked = r.total - r.linked;
    console.log(
      `  ${r.lang_slug.padEnd(20)}  ${String(r.total).padStart(5)}   ${String(r.linked).padStart(6)}   ${String(unlinked).padStart(8)}`,
    );
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
