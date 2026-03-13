import { getConnection } from './lib/db';

async function main() {
  const db = await getConnection();

  // Check raw meta count
  const [metaCheck] = await db.query<any[]>(
    `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE meta_key = '_product_video_id'`
  );
  console.log(`Total _product_video_id meta rows: ${metaCheck[0].cnt}\n`);

  // List products with video meta
  const [rows] = await db.query<any[]>(`
    SELECT p.ID, p.post_title, p.post_name, p.post_status,
           pm.meta_value as video_attachment_id,
           att.guid as video_url
    FROM wp_postmeta pm
    JOIN wp_posts p ON p.ID = pm.post_id
    LEFT JOIN wp_posts att ON att.ID = CAST(pm.meta_value AS UNSIGNED)
    WHERE pm.meta_key = '_product_video_id'
    LIMIT 15
  `);

  for (const r of rows) {
    console.log(`ID: ${r.ID} | ${r.post_title} (${r.post_status})`);
    console.log(`  slug: ${r.post_name}`);
    console.log(`  video attachment: ${r.video_attachment_id} → ${r.video_url || 'NULL'}`);
    console.log();
  }

  await db.end();
}

main().catch(console.error);
