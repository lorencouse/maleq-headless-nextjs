/**
 * Registers video attachment rows in the local DB for MP4 paths referenced in reusable blocks.
 * This is a helper so attach-product-videos.ts can resolve paths to attachment IDs locally.
 *
 * Usage: bun scripts/register-local-videos.ts --local
 */
import { getConnection } from './lib/db';

async function main() {
  const db = await getConnection();

  const [optRows] = await db.query<any[]>(
    `SELECT option_value FROM wp_options WHERE option_name = "siteurl" LIMIT 1`
  );
  const siteUrl = optRows[0]?.option_value || 'http://maleq-local.local';
  console.log('Site URL:', siteUrl);

  const [blocks] = await db.query<any[]>(`
    SELECT post_content FROM wp_posts
    WHERE post_type = 'wp_block' AND post_status = 'publish' AND post_content LIKE '%.mp4%'
  `);

  const videoPaths = new Set<string>();
  for (const b of blocks) {
    for (const m of b.post_content.matchAll(/src="([^"]*\.mp4)"/g)) {
      videoPaths.add(m[1]);
    }
  }
  console.log(`Unique video paths in blocks: ${videoPaths.size}`);

  const [existing] = await db.query<any[]>(
    `SELECT guid FROM wp_posts WHERE post_type = 'attachment' AND post_mime_type LIKE 'video%'`
  );
  const existingPaths = new Set(
    existing.map((r: any) => {
      const m = r.guid.match(/(\/wp-content\/uploads\/.+)$/);
      return m ? m[1] : r.guid;
    })
  );
  console.log(`Already registered: ${existingPaths.size}`);

  let registered = 0;
  for (const vpath of videoPaths) {
    if (existingPaths.has(vpath)) continue;
    const parts = vpath.split('/');
    const filename = parts[parts.length - 1];
    const title = filename.replace(/\.mp4$/, '').replace(/[-_]/g, ' ');
    const guid = siteUrl + vpath;

    await db.query(
      `INSERT INTO wp_posts (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, comment_status, ping_status, post_name, to_ping, pinged, post_content_filtered,
        post_type, post_mime_type, guid)
       VALUES (1, NOW(), UTC_TIMESTAMP(), '', ?, '', 'inherit', 'open', 'closed', ?, '', '', '',
        'attachment', 'video/mp4', ?)`,
      [title, filename.replace(/\.mp4$/, ''), guid]
    );
    registered++;
  }

  console.log(`Registered ${registered} new video attachments`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
