#!/usr/bin/env bun
/**
 * Fix old maleq.com blog crosslinks in post/wp_block content.
 *
 * Old URLs like https://www.maleq.com/best-cock-rings/ need to become /guides/best-cock-rings/
 * Some slugs were renamed — this script includes fuzzy-matched mappings.
 *
 * Usage:
 *   bun scripts/fix-blog-crosslinks.ts --dry-run   (preview changes)
 *   bun scripts/fix-blog-crosslinks.ts --apply      (apply changes)
 */

import { getConnection } from './lib/db';

// ─── Exact & fuzzy-matched blog URL mappings ───────────────────────────────
// Format: old full URL -> new relative path
// Built by matching slugs against wp_posts, with fuzzy resolution for renamed articles.

const URL_MAPPING: Record<string, string> = {
  // === Blog posts: exact slug match or simple variant (the- prefix, year suffix, -2 suffix) ===
  'https://www.maleq.com/the-best-cock-rings/': '/guides/best-cock-rings/',
  'https://www.maleq.com/the-best-butt-plugs/': '/guides/best-butt-plugs-and-anal-stoppers/',
  'https://www.maleq.com/the-secret-to-harder-longer-lasting-erections/': '/guides/how-to-get-harder-erections-better-boners/',
  'https://www.maleq.com/best-anal-lubes-2016/': '/guides/best-anal-lubes/',
  'http://www.maleq.com/best-viagra-alternatives/': '/guides/best-viagra-alternatives-2/',
  'https://www.maleq.com/best-viagra-alternatives/': '/guides/best-viagra-alternatives-2/',

  // === Fuzzy-matched: slug renamed between old and new site ===
  'https://www.maleq.com/10-best-prostate-toys-sure-to-make-you-cum/': '/guides/best-prostate-toys-massagers/',
  'https://www.maleq.com/best-anal-vibrators/': '/guides/best-anal-vibrators-for-men-prostate-sex-toys/',
  'https://www.maleq.com/best-g-spot-vibrators-of-2021-for-ultimate-orgasms/': '/guides/best-g-spot-vibrators-for-ultimate-orgasms/',
  'https://www.maleq.com/best-glass-dildos-10-beautiful-and-thrilling-toys/': '/guides/best-glass-dildos-and-sex-toys/',
  'https://www.maleq.com/best-strap-on-hollow-dildos-for-men/': '/guides/best-hollow-strap-on-dildos-for-men/',
  'https://www.maleq.com/can-you-get-hiv-from-oral/': '/guides/can-you-get-hiv-from-oral-sex/',
  'https://www.maleq.com/sometimes-shit-happens/': '/guides/sometimes-shit-happens-how-to-have-cleaner-anal-sex/',
  'https://www.maleq.com/best-dildo-for-women/': '/guides/best-dildos-and-dongs/',
  'https://www.maleq.com/top-10-anal-lubes/': '/guides/best-anal-lubes/',
  'https://www.maleq.com/stories/top-10-anal-lubes/': '/guides/best-anal-lubes/',

  // === Spanish articles: slug renamed (year suffix removed, etc.) ===
  'https://www.maleq.com/mejores-lubricantes-anales-probados-para-un-sexo-suave-y-sin-dolor-2/': '/guides/mejores-lubricantes-anales-probados/',
  'https://www.maleq.com/mejores-anillos-de-polla-para-erecciones-duras-como-roca-2019/': '/guides/mejores-anillos-de-polla-para-erecciones-duras/',
  'https://www.maleq.com/guia-del-comprador-de-los-mejores-lubricantes-de-silicona-de-2019/': '/guides/los-mejores-lubricantes-de-silicona/',

  // === Chinese articles: old slugs -> closest current match ===
  'https://www.maleq.com/%e6%96%b0%e6%89%8b%e9%81%a9%e7%94%a8-%e8%82%9b%e4%ba%a4%e6%8c%89%e6%91%a9%e6%a3%92%e9%a6%96%e9%81%b8-2/':
    '/guides/%e8%82%9b%e4%ba%a4%e7%8e%a9%e5%85%b7-%e6%96%b0%e6%89%8b%e5%85%a5%e9%96%80%e5%81%87%e5%b1%8c-%e6%8e%a8%e8%96%a6%e8%82%9b%e4%ba%a4%e7%8e%a9%e5%85%b7%e6%a3%92/',
  'https://www.maleq.com/%e9%81%b8%e8%b3%bc2019%e5%b9%b4%e6%9c%80%e5%a5%bd%e7%9a%84%e8%82%9b%e9%96%80%e6%bd%a4%e6%bb%91%e6%b6%b2/':
    '/guides/%e9%81%b8%e8%b3%bc%e6%9c%80%e5%a5%bd%e7%9a%84%e6%8e%a8%e8%96%a6%e8%82%9b%e9%96%80%e6%bd%a4%e6%bb%91%e6%b6%b2/',

  // === Product review -> closest article ===
  'https://www.maleq.com/swiss-navy-water-based-lube-review/': '/guides/best-water-based-lube/',

  // === Manufacturer page -> related review ===
  'https://www.maleq.com/manufacturer/tenga/': '/guides/tenga-egg-review-masturbator/',

  // === Old store/site pages -> /shop (no blog equivalent) ===
  'https://www.maleq.com/male-q-adult-store/': '/shop/',
  'https://www.maleq.com/mq-store-adult-sex-toys/': '/shop/',
  'https://www.maleq.com/male-q-sex-advice/male-q-mq-store-home-wide/': '/shop/',

  // === Old store search -> current shop ===
  'http://store.maleq.com/search?q=dental': '/shop/?q=dental+dam',

  // === Old Chinese product pages (store.maleq.com) -> shop ===
  'https://store.maleq.com/zh-hant/product/pjur-%E5%BE%8C%E5%BA%AD%E8%82%9B%E4%BA%A4%E6%BD%A4%E6%BB%91%E6%B6%B2/': '/guides/pjur-analyse-me-review-lube-made-anal-sex/',
  'https://store.maleq.com/zh-hant/product/%E7%81%8C%E8%85%B8%E5%99%A8%EF%BD%9C%E7%94%B7%E7%94%A8%E5%A5%97%E7%92%B0%E7%B5%84%E5%90%88/': '/shop/',

  // === Old BuddyPress/member pages -> remove (link to homepage) ===
  'https://www.maleq.com/members/maleqorg/profile/': '/',
  'https://www.maleq.com/members/maleqorg/settings/': '/',
  'https://www.maleq.com/members/maleqorg/activity/': '/',
  'https://www.maleq.com/members/maleqorg/notifications/': '/',
  'https://www.maleq.com/members/maleqorg/messages/': '/',
  'https://www.maleq.com/members/maleqorg/friends/': '/',
  'https://www.maleq.com/members/maleqorg/groups/': '/',
  'https://www.maleq.com/members/maleqorg/forums/': '/',
  'https://www.maleq.com/wp-login.php?action=logout': '/',

  // === Old male-q/sex/best path (wp_block banner) ===
  'https://www.maleq.com/male-q/sex/best/sex-toys/male/': '/sex-toys/sextoys-for-men/',
};

interface Replacement {
  postId: number;
  postTitle: string;
  postType: string;
  oldUrl: string;
  newUrl: string;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--apply') {
    console.log('Usage: bun scripts/fix-blog-crosslinks.ts --dry-run|--apply');
    process.exit(1);
  }

  const dryRun = mode === '--dry-run';
  const conn = await getConnection();

  try {
    // Build search patterns from all old URLs
    // We need to find posts containing ANY of these old URLs
    const domains = ['maleq.com/', 'store.maleq.com/'];
    const likeConditions = domains.map(d => `post_content LIKE '%${d}%'`).join(' OR ');

    const [rows] = await conn.query<any[]>(`
      SELECT ID, post_title, post_type, post_content
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page', 'wp_block')
        AND (${likeConditions})
      ORDER BY ID
    `);

    console.log(`Found ${rows.length} posts/blocks with maleq.com links\n`);

    const replacements: Replacement[] = [];
    let updatedCount = 0;

    // Sort mappings longest-first to avoid prefix conflicts
    const sortedEntries = Object.entries(URL_MAPPING).sort((a, b) => b[0].length - a[0].length);

    for (const row of rows) {
      let content = row.post_content as string;
      let changed = false;
      const postReplacements: Replacement[] = [];

      for (const [oldUrl, newUrl] of sortedEntries) {
        if (content.includes(oldUrl)) {
          const count = content.split(oldUrl).length - 1;
          content = content.replaceAll(oldUrl, newUrl);
          changed = true;

          for (let i = 0; i < count; i++) {
            postReplacements.push({
              postId: row.ID,
              postTitle: row.post_title,
              postType: row.post_type,
              oldUrl,
              newUrl,
            });
          }
        }
      }

      if (changed) {
        if (dryRun) {
          console.log(`[${row.post_type}] Post ${row.ID}: ${row.post_title}`);
          for (const r of postReplacements) {
            console.log(`  ${r.oldUrl}`);
            console.log(`  → ${r.newUrl}`);
          }
          console.log();
        } else {
          await conn.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, row.ID]);
          console.log(`Updated [${row.post_type}] ${row.ID}: ${row.post_title} (${postReplacements.length} links)`);
        }

        updatedCount++;
        replacements.push(...postReplacements);
      }
    }

    // Summary
    console.log('---');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
    console.log(`Posts/blocks updated: ${updatedCount}`);
    console.log(`Total link replacements: ${replacements.length}`);

    // Check for any remaining old-domain URLs
    const [remaining] = await conn.query<any[]>(`
      SELECT ID, post_title, post_type
      FROM wp_posts
      WHERE post_status IN ('publish', 'draft')
        AND post_type IN ('post', 'page', 'wp_block')
        AND (post_content LIKE '%maleq.com/%' OR post_content LIKE '%store.maleq.com/%')
      ORDER BY ID
    `);

    if (remaining.length > 0) {
      console.log(`\nNote: ${remaining.length} posts still have maleq.com URLs (may be image src or already-valid):`);
      for (const r of remaining) {
        console.log(`  [${r.post_type}] ${r.ID}: ${r.post_title}`);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
