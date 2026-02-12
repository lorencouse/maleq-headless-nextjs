/**
 * Fix maleq.com hotlinks in WordPress database.
 *
 * Automatically converts:
 *   - Image/upload URLs → relative /wp-content/uploads/...
 *   - Blog cross-links  → relative /slug/
 *
 * Reports for manual review:
 *   - Product page links (/product/...)
 *   - Site page links (/contact-us/, etc.)
 *   - Cart/checkout/account links
 *   - Blog taxonomy links
 *   - AMP plugin images
 *
 * Usage:
 *   bun run scripts/fix-maleq-links.ts --dry-run   (preview changes)
 *   bun run scripts/fix-maleq-links.ts --apply      (apply changes)
 */
import { getConnection } from './lib/db';
import fs from 'fs';
import path from 'path';

const WP_ROOT = path.join(
  process.env.HOME || '/Users/lorencouse',
  'Local Sites/maleq-local/app/public'
);

const MALEQ_URL_RE =
  /https?:\/\/(?:www\.|store\.)?maleq\.com(\/[^\s"'<>)}\]\\]*)/gi;

interface Replacement {
  postId: number;
  postTitle: string;
  oldUrl: string;
  newUrl: string;
  category: string;
  valid: boolean;
  validationNote: string;
}

interface ManualItem {
  postId: number;
  postTitle: string;
  url: string;
  category: string;
  reason: string;
}

function categorizePathname(pathname: string): string {
  if (/^\/wp-content\/uploads\//i.test(pathname)) return 'image';
  if (/^\/wp-content\/plugins\//i.test(pathname)) return 'plugin-asset';
  if (/^\/product\//i.test(pathname)) return 'product-page';
  if (/^\/product-category\//i.test(pathname)) return 'product-category';
  if (/^\/shop\b/i.test(pathname)) return 'shop-page';
  if (/^\/(cart|checkout|my-account)\b/i.test(pathname)) return 'cart-checkout';
  if (/^\/(about|contact|privacy|terms|faq|shipping|returns)/i.test(pathname)) return 'site-page';
  if (/^\/(tag|category)\//i.test(pathname)) return 'blog-taxonomy';
  if (/^\/male-q\//i.test(pathname)) return 'site-page'; // old site section
  return 'blog-crosslink';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  if (!dryRun && !apply) {
    console.log('Usage: bun run scripts/fix-maleq-links.ts --dry-run | --apply');
    process.exit(1);
  }

  const db = await getConnection();

  // Load all published post slugs for validation
  console.log('Loading post slugs for validation...');
  const [postSlugs] = await db.query<any[]>(
    `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type IN ('post', 'page')`
  );
  const validSlugs = new Set(postSlugs.map((r: any) => r.post_name.toLowerCase()));
  console.log(`  ${validSlugs.size} published post/page slugs loaded.`);

  // Load all posts with maleq.com in content
  console.log('Loading posts with maleq.com references...\n');
  const [rows] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, post_status, post_content
     FROM wp_posts
     WHERE post_content LIKE '%maleq.com%'
       AND post_status = 'publish'`
  );
  console.log(`  ${rows.length} published posts contain maleq.com URLs.\n`);

  const replacements: Replacement[] = [];
  const manualItems: ManualItem[] = [];
  const postUpdates = new Map<number, { title: string; content: string }>();

  for (const row of rows) {
    let content: string = row.post_content;
    let modified = false;

    // Find all maleq.com URLs
    const matches: { full: string; pathname: string }[] = [];
    let m;
    MALEQ_URL_RE.lastIndex = 0;
    while ((m = MALEQ_URL_RE.exec(content)) !== null) {
      matches.push({ full: m[0], pathname: m[1] });
    }

    // Deduplicate by full URL (process each unique URL once)
    const seen = new Set<string>();
    for (const { full, pathname } of matches) {
      if (seen.has(full)) continue;
      seen.add(full);

      const cat = categorizePathname(pathname);

      // Categories that need manual review
      if (['product-page', 'product-category', 'shop-page', 'cart-checkout', 'site-page', 'blog-taxonomy'].includes(cat)) {
        manualItems.push({
          postId: row.ID,
          postTitle: row.post_title,
          url: full,
          category: cat,
          reason: `Old ${cat} URL — needs new path or removal`,
        });
        continue;
      }

      // Plugin assets (AMP story templates etc.) — these are hotlinks to plugin files
      if (cat === 'plugin-asset') {
        manualItems.push({
          postId: row.ID,
          postTitle: row.post_title,
          url: full,
          category: cat,
          reason: 'Plugin asset hotlink — may not exist locally',
        });
        continue;
      }

      // Image/upload → relative path
      if (cat === 'image') {
        const relativePath = pathname;
        const localFile = path.join(WP_ROOT, relativePath);
        const exists = fs.existsSync(localFile);

        replacements.push({
          postId: row.ID,
          postTitle: row.post_title,
          oldUrl: full,
          newUrl: relativePath,
          category: 'image',
          valid: exists,
          validationNote: exists ? 'File exists locally' : `MISSING: ${localFile}`,
        });

        if (exists) {
          content = content.replaceAll(full, relativePath);
          modified = true;
        }
        continue;
      }

      // Blog cross-link → relative path
      if (cat === 'blog-crosslink') {
        // Extract the slug from the pathname (first path segment)
        const cleanPath = pathname.replace(/\?.*$/, '').replace(/#.*$/, '');
        const segments = cleanPath.split('/').filter(Boolean);
        const slug = segments[segments.length - 1]?.toLowerCase() || '';

        const slugExists = validSlugs.has(slug);
        const relativePath = cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';

        replacements.push({
          postId: row.ID,
          postTitle: row.post_title,
          oldUrl: full,
          newUrl: relativePath,
          category: 'blog-crosslink',
          valid: slugExists,
          validationNote: slugExists
            ? `Slug "${slug}" exists`
            : `SLUG NOT FOUND: "${slug}" — may be old/renamed`,
        });

        // Only replace if slug is valid
        if (slugExists) {
          content = content.replaceAll(full, relativePath);
          modified = true;
        } else {
          manualItems.push({
            postId: row.ID,
            postTitle: row.post_title,
            url: full,
            category: 'blog-crosslink-broken',
            reason: `Blog slug "${slug}" not found in DB — may be renamed or deleted`,
          });
        }
        continue;
      }
    }

    if (modified) {
      postUpdates.set(row.ID, { title: row.post_title, content });
    }
  }

  // ===== Also handle wp_comments =====
  console.log('Checking wp_comments...');
  const [commentRows] = await db.query<any[]>(
    `SELECT comment_ID, comment_post_ID, comment_author, comment_content, comment_author_url
     FROM wp_comments
     WHERE comment_content LIKE '%maleq.com%' OR comment_author_url LIKE '%maleq.com%'`
  );

  const commentUpdates: { id: number; field: string; oldVal: string; newVal: string }[] = [];
  for (const row of commentRows) {
    // Fix comment content
    if (row.comment_content?.includes('maleq.com')) {
      let newContent = row.comment_content as string;
      let changed = false;
      MALEQ_URL_RE.lastIndex = 0;
      let cm;
      while ((cm = MALEQ_URL_RE.exec(row.comment_content)) !== null) {
        const pathname = cm[1];
        const cat = categorizePathname(pathname);
        if (cat === 'blog-crosslink') {
          const cleanPath = pathname.replace(/\?.*$/, '').replace(/#.*$/, '');
          const slug = cleanPath.split('/').filter(Boolean).pop()?.toLowerCase() || '';
          if (validSlugs.has(slug)) {
            const relPath = cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
            newContent = newContent.replaceAll(cm[0], relPath);
            changed = true;
          }
        } else if (cat === 'image') {
          const localFile = path.join(WP_ROOT, pathname);
          if (fs.existsSync(localFile)) {
            newContent = newContent.replaceAll(cm[0], pathname);
            changed = true;
          }
        }
      }
      if (changed) {
        commentUpdates.push({ id: row.comment_ID, field: 'comment_content', oldVal: row.comment_content, newVal: newContent });
      }
    }

    // Fix comment author URL (just strip to relative or keep domain-only)
    if (row.comment_author_url?.includes('maleq.com')) {
      // Author URLs like "http://www.maleq.com" — these are fine, they reference the homepage
      // We'll leave these as-is since the domain is staying
    }
  }

  // ===== Handle wp_postmeta (oembed caches) =====
  console.log('Checking wp_postmeta oembed caches...');
  const [oembedRows] = await db.query<any[]>(
    `SELECT meta_id, post_id, meta_key FROM wp_postmeta
     WHERE meta_key LIKE '_oembed_%' AND meta_value LIKE '%maleq.com%'`
  );

  // ===== REPORT =====
  console.log(`\n${'='.repeat(80)}`);
  console.log(dryRun ? 'DRY RUN — No changes will be made' : 'APPLYING CHANGES');
  console.log(`${'='.repeat(80)}\n`);

  // Valid replacements
  const validReplacements = replacements.filter(r => r.valid);
  const invalidReplacements = replacements.filter(r => !r.valid);

  console.log(`--- AUTOMATIC FIXES (${validReplacements.length} valid replacements) ---\n`);

  // Group by category
  const byCategory = new Map<string, Replacement[]>();
  for (const r of validReplacements) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  for (const [cat, items] of byCategory) {
    const uniqueUrls = new Set(items.map(i => i.oldUrl));
    const affectedPosts = new Set(items.map(i => i.postId));
    console.log(`  [${cat.toUpperCase()}] ${items.length} replacements (${uniqueUrls.size} unique URLs, ${affectedPosts.size} posts)`);
  }

  console.log(`\n  Posts to update: ${postUpdates.size}`);
  console.log(`  Comments to update: ${commentUpdates.length}`);
  console.log(`  Oembed caches to delete: ${oembedRows.length}`);

  // Invalid replacements (files/slugs not found)
  if (invalidReplacements.length > 0) {
    console.log(`\n--- SKIPPED — VALIDATION FAILED (${invalidReplacements.length}) ---\n`);
    for (const r of invalidReplacements) {
      console.log(`  Post ${r.postId}: ${r.oldUrl}`);
      console.log(`    → ${r.validationNote}`);
    }
  }

  // Manual review items
  if (manualItems.length > 0) {
    console.log(`\n--- MANUAL REVIEW REQUIRED (${manualItems.length}) ---\n`);
    const byCat = new Map<string, ManualItem[]>();
    for (const item of manualItems) {
      if (!byCat.has(item.category)) byCat.set(item.category, []);
      byCat.get(item.category)!.push(item);
    }
    for (const [cat, items] of byCat) {
      console.log(`  [${cat.toUpperCase()}]`);
      for (const item of items) {
        console.log(`    Post ${item.postId} "${item.postTitle}"`);
        console.log(`      URL: ${item.url}`);
        console.log(`      Reason: ${item.reason}`);
      }
      console.log();
    }
  }

  // Apply changes
  if (apply) {
    console.log('\nApplying changes...');

    let updatedPosts = 0;
    for (const [postId, data] of postUpdates) {
      await db.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [data.content, postId]);
      updatedPosts++;
    }
    console.log(`  Updated ${updatedPosts} posts.`);

    let updatedComments = 0;
    for (const cu of commentUpdates) {
      await db.query(`UPDATE wp_comments SET ${cu.field} = ? WHERE comment_ID = ?`, [cu.newVal, cu.id]);
      updatedComments++;
    }
    console.log(`  Updated ${updatedComments} comments.`);

    // Delete stale oembed caches
    if (oembedRows.length > 0) {
      const metaIds = oembedRows.map((r: any) => r.meta_id);
      await db.query('DELETE FROM wp_postmeta WHERE meta_id IN (?)', [metaIds]);
      console.log(`  Deleted ${oembedRows.length} stale oembed cache entries.`);
    }

    console.log('\nDone! Running post-apply validation...\n');

    // ===== POST-APPLY VALIDATION =====
    await runValidation(db);
  } else {
    console.log('\nDry run complete. Use --apply to make changes.');
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'apply',
    summary: {
      validReplacements: validReplacements.length,
      invalidReplacements: invalidReplacements.length,
      manualReviewItems: manualItems.length,
      postsUpdated: postUpdates.size,
      commentsUpdated: commentUpdates.length,
      oembedCachesDeleted: oembedRows.length,
    },
    validReplacements: validReplacements.map(r => ({
      postId: r.postId, oldUrl: r.oldUrl, newUrl: r.newUrl, category: r.category,
    })),
    invalidReplacements: invalidReplacements.map(r => ({
      postId: r.postId, oldUrl: r.oldUrl, category: r.category, note: r.validationNote,
    })),
    manualReview: manualItems,
  };

  const reportPath = path.join(process.cwd(), 'data', `maleq-link-fix-${dryRun ? 'dryrun' : 'applied'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  await db.end();
}

async function runValidation(db: any) {
  console.log('=== POST-APPLY VALIDATION ===\n');

  // 1. Check no absolute maleq.com URLs remain in post_content (excluding mailto)
  const [remaining] = await db.query<any[]>(
    `SELECT ID, post_title,
       SUBSTRING(post_content, GREATEST(1, LOCATE('maleq.com', post_content) - 40), 120) AS snippet
     FROM wp_posts
     WHERE post_content LIKE '%maleq.com%'
       AND post_status = 'publish'`
  );

  // Filter: only flag non-email maleq.com URLs
  const problematic: any[] = [];
  for (const row of remaining) {
    const content = (await db.query<any[]>(
      'SELECT post_content FROM wp_posts WHERE ID = ?', [row.ID]
    ))[0][0]?.post_content || '';

    // Check if any non-mailto maleq.com URLs remain
    const nonMailto = content.match(/https?:\/\/(?:www\.|store\.)?maleq\.com/gi);
    if (nonMailto && nonMailto.length > 0) {
      problematic.push(row);
    }
  }

  if (problematic.length === 0) {
    console.log('  [PASS] No absolute maleq.com http(s) URLs remain in published post_content.');
  } else {
    console.log(`  [INFO] ${problematic.length} posts still have maleq.com URLs (expected — manual review items):`);
    for (const row of problematic.slice(0, 10)) {
      console.log(`    Post ${row.ID}: ${row.post_title}`);
      console.log(`      ${row.snippet.replace(/\n/g, ' ')}`);
    }
    if (problematic.length > 10) console.log(`    ... and ${problematic.length - 10} more`);
  }

  // 2. Verify relative image links point to existing files
  console.log('\n  Validating relative image paths...');
  const [imgPosts] = await db.query<any[]>(
    `SELECT ID, post_content FROM wp_posts
     WHERE post_content LIKE '%/wp-content/uploads/%'
       AND post_status = 'publish'`
  );

  const missingImages = new Set<string>();
  const checkedImages = new Set<string>();
  const imgRe = /(?:src|href)=["'](\/wp-content\/uploads\/[^"']+)["']/gi;

  for (const row of imgPosts) {
    imgRe.lastIndex = 0;
    let im;
    while ((im = imgRe.exec(row.post_content)) !== null) {
      const relPath = im[1];
      if (checkedImages.has(relPath)) {
        if (missingImages.has(relPath)) continue;
        continue;
      }
      checkedImages.add(relPath);
      const localPath = path.join(WP_ROOT, relPath);
      if (!fs.existsSync(localPath)) {
        missingImages.add(relPath);
      }
    }
  }

  if (missingImages.size === 0) {
    console.log(`  [PASS] All ${checkedImages.size} relative image paths verified — files exist locally.`);
  } else {
    console.log(`  [WARN] ${missingImages.size} of ${checkedImages.size} relative image paths are MISSING locally:`);
    for (const p of [...missingImages].slice(0, 15)) {
      console.log(`    MISSING: ${p}`);
    }
    if (missingImages.size > 15) console.log(`    ... and ${missingImages.size - 15} more`);
  }

  // 3. Verify relative blog links have valid slugs
  console.log('\n  Validating relative blog link slugs...');
  const [blogPosts] = await db.query<any[]>(
    `SELECT ID, post_content FROM wp_posts
     WHERE post_status = 'publish'
       AND post_content LIKE '%href="/%'`
  );

  const [slugRows] = await db.query<any[]>(
    `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type IN ('post', 'page')`
  );
  const allSlugs = new Set(slugRows.map((r: any) => r.post_name.toLowerCase()));

  // Only check relative links that look like blog post slugs (not /wp-content, /product, etc.)
  const blogLinkRe = /href=["']\/([\w][\w-]*(?:\/[\w][\w-]*)*)\/?\s*["']/gi;
  const brokenSlugs = new Map<string, number[]>(); // slug → post IDs
  const validSlugCount = { total: 0, valid: 0 };

  const skipPrefixes = ['wp-content', 'wp-admin', 'wp-includes', 'product', 'product-category', 'shop', 'cart', 'checkout', 'my-account', 'tag', 'category'];

  for (const row of blogPosts) {
    blogLinkRe.lastIndex = 0;
    let bm;
    while ((bm = blogLinkRe.exec(row.post_content)) !== null) {
      const fullPath = bm[1];
      const firstSegment = fullPath.split('/')[0];
      if (skipPrefixes.includes(firstSegment)) continue;

      // The slug is the last segment
      const slug = fullPath.split('/').filter(Boolean).pop()?.toLowerCase() || '';
      if (!slug || slug.length < 2) continue;

      validSlugCount.total++;
      if (allSlugs.has(slug)) {
        validSlugCount.valid++;
      } else {
        if (!brokenSlugs.has(slug)) brokenSlugs.set(slug, []);
        brokenSlugs.get(slug)!.push(row.ID);
      }
    }
  }

  if (brokenSlugs.size === 0) {
    console.log(`  [PASS] All ${validSlugCount.total} relative blog links have valid slugs.`);
  } else {
    console.log(`  [INFO] ${validSlugCount.valid}/${validSlugCount.total} relative blog links valid. ${brokenSlugs.size} unique slugs not found:`);
    for (const [slug, postIds] of [...brokenSlugs.entries()].slice(0, 15)) {
      console.log(`    "${slug}" — referenced in posts: ${postIds.join(', ')}`);
    }
    if (brokenSlugs.size > 15) console.log(`    ... and ${brokenSlugs.size - 15} more`);
  }

  // 4. Check no maleq.com in postmeta oembed caches
  const [oembedRemain] = await db.query<any[]>(
    `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE meta_key LIKE '_oembed_%' AND meta_value LIKE '%maleq.com%'`
  );
  const oembedCount = oembedRemain[0]?.cnt || 0;
  if (oembedCount === 0) {
    console.log('\n  [PASS] No stale oembed caches with maleq.com remain.');
  } else {
    console.log(`\n  [WARN] ${oembedCount} oembed cache entries still reference maleq.com.`);
  }

  console.log('\nValidation complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
