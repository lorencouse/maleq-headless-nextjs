/**
 * Attach product videos from reusable blocks.
 *
 * Scans wp_block posts that contain an MP4 video + [add_to_cart id="X"] shortcode,
 * resolves the video file to a media-library attachment ID, and writes
 * _product_video_id meta on the matching product.
 *
 * Usage:
 *   bun scripts/attach-product-videos.ts --local          # dry-run on local DB
 *   bun scripts/attach-product-videos.ts --local --write   # apply to local DB
 *   bun scripts/attach-product-videos.ts --write           # apply to remote (via tunnel)
 */

import { getConnection } from './lib/db';

const dryRun = !process.argv.includes('--write');

interface Block {
  ID: number;
  post_title: string;
  post_content: string;
}

interface AttachmentRow {
  ID: number;
  guid: string;
}

interface MetaRow {
  meta_value: string;
}

async function main() {
  const db = await getConnection();

  if (dryRun) {
    console.log('🔍 DRY RUN — pass --write to apply changes\n');
  }

  // 1. Fetch all reusable blocks with MP4
  const [blocks] = await db.query<Block[]>(`
    SELECT ID, post_title, post_content
    FROM wp_posts
    WHERE post_type = 'wp_block'
      AND post_status = 'publish'
      AND post_content LIKE '%.mp4%'
  `);

  console.log(`Found ${blocks.length} reusable blocks with MP4 videos\n`);

  // 2. Build video-to-product mappings
  const mappings: { blockId: number; blockTitle: string; videoPath: string; productId: number }[] = [];

  for (const block of blocks) {
    const videoMatch = block.post_content.match(/src="([^"]*\.mp4)"/);
    const productMatch = block.post_content.match(/\[add_to_cart\s+id="(\d+)"\]/);

    if (!videoMatch || !productMatch) {
      console.log(`⚠️  Block ${block.ID} (${block.post_title}): missing video or product shortcode — skipped`);
      continue;
    }

    mappings.push({
      blockId: block.ID,
      blockTitle: block.post_title,
      videoPath: videoMatch[1],
      productId: parseInt(productMatch[1], 10),
    });
  }

  console.log(`Parsed ${mappings.length} video→product mappings\n`);

  // 3. Resolve video paths to attachment IDs
  //    Videos are stored with relative paths like /wp-content/uploads/2020/03/file.mp4
  //    Attachment GUIDs contain the full URL. We match on the filename portion.
  const [attachments] = await db.query<AttachmentRow[]>(`
    SELECT ID, guid
    FROM wp_posts
    WHERE post_type = 'attachment'
      AND post_mime_type LIKE 'video%'
  `);

  // Index by filename for fast lookup
  const attachmentByFilename = new Map<string, AttachmentRow>();
  // Also index by relative path for more precise matching
  const attachmentByPath = new Map<string, AttachmentRow>();
  for (const att of attachments) {
    const filename = att.guid.split('/').pop()!;
    attachmentByFilename.set(filename, att);
    // Extract /wp-content/uploads/... portion
    const pathMatch = att.guid.match(/(\/wp-content\/uploads\/.+)$/);
    if (pathMatch) {
      attachmentByPath.set(pathMatch[1], att);
    }
  }

  console.log(`${attachments.length} video attachments in media library\n`);

  // 4. Process each mapping
  let attached = 0;
  let skippedExisting = 0;
  let skippedNoAttachment = 0;
  let skippedNoProduct = 0;

  for (const m of mappings) {
    // Try path match first, then filename
    let attachment = attachmentByPath.get(m.videoPath);
    if (!attachment) {
      const filename = m.videoPath.split('/').pop()!;
      attachment = attachmentByFilename.get(filename);
    }

    if (!attachment) {
      console.log(`❌ No attachment found for: ${m.videoPath} (block ${m.blockId})`);
      skippedNoAttachment++;
      continue;
    }

    // Check product exists
    const [productCheck] = await db.query<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM wp_posts WHERE ID = ? AND post_type = 'product'`,
      [m.productId]
    );
    if (!productCheck[0]?.cnt) {
      console.log(`❌ Product ${m.productId} not found (block ${m.blockId}: ${m.blockTitle})`);
      skippedNoProduct++;
      continue;
    }

    // Check if already has a video
    const [existingMeta] = await db.query<MetaRow[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_product_video_id' LIMIT 1`,
      [m.productId]
    );
    if (existingMeta.length > 0) {
      console.log(`⏭️  Product ${m.productId} already has video (attachment ${existingMeta[0].meta_value}) — skipped`);
      skippedExisting++;
      continue;
    }

    console.log(`✅ Product ${m.productId} ← attachment ${attachment.ID} (${m.videoPath.split('/').pop()})`);

    if (!dryRun) {
      await db.query(
        `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_product_video_id', ?)`,
        [m.productId, attachment.ID]
      );
    }

    attached++;
  }

  console.log('\n--- Summary ---');
  console.log(`Attached: ${attached}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Skipped (already has video): ${skippedExisting}`);
  console.log(`Skipped (no attachment in library): ${skippedNoAttachment}`);
  console.log(`Skipped (product not found): ${skippedNoProduct}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
