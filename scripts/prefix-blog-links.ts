/**
 * Prefix relative blog cross-links with /guides/
 * Converts href="/best-lubes/" → href="/guides/best-lubes/"
 *
 * Only targets links whose slug matches a published post in the DB.
 *
 * Usage:
 *   bun run scripts/prefix-blog-links.ts --dry-run
 *   bun run scripts/prefix-blog-links.ts --apply
 */
import { getConnection } from './lib/db';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  if (!dryRun && !apply) {
    console.log('Usage: bun run scripts/prefix-blog-links.ts --dry-run | --apply');
    process.exit(1);
  }

  const db = await getConnection();

  // Load all published post slugs
  console.log('Loading published post slugs...');
  const [slugRows] = await db.query<any[]>(
    `SELECT post_name FROM wp_posts WHERE post_status = 'publish' AND post_type = 'post'`
  );
  const postSlugs = new Set(slugRows.map((r: any) => r.post_name.toLowerCase()));
  console.log(`  ${postSlugs.size} published post slugs loaded.\n`);

  // Build a regex that matches href="/slug/" where slug is a known blog post
  // We need to find relative links that are NOT already prefixed and NOT wp-content, product, etc.
  const skipPrefixes = [
    'wp-content', 'wp-admin', 'wp-includes', 'product', 'product-category',
    'shop', 'cart', 'checkout', 'my-account', 'tag', 'category', 'blog',
    'guides', 'about', 'contact', 'privacy', 'terms', 'faq', 'shipping',
    'returns', 'brand', 'brands', 'search', 'account', 'login', 'register',
    'forgot-password', 'reset-password', 'order-confirmation', 'api', 'admin',
    'images', 'fonts', 'graphql',
  ];

  // Load posts with relative href links
  console.log('Scanning posts for relative blog links...');
  const [rows] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, post_content
     FROM wp_posts
     WHERE post_status = 'publish'
       AND post_content REGEXP 'href="\/[a-z]'`
  );
  console.log(`  ${rows.length} posts have relative links.\n`);

  let totalReplacements = 0;
  let totalPosts = 0;
  const changes: { postId: number; title: string; from: string; to: string }[] = [];

  for (const row of rows) {
    let content: string = row.post_content;
    let modified = false;

    // Match href="/something/" or href="/something" (relative links)
    const linkRe = /href="(\/([a-z0-9][\w-]*(?:\/[\w-]*)*)\/?)"/gi;
    let match;
    const replacements = new Map<string, string>();

    while ((match = linkRe.exec(content)) !== null) {
      const fullPath = match[1];
      const innerPath = match[2]; // without leading slash
      const firstSegment = innerPath.split('/')[0];

      // Skip non-blog prefixes
      if (skipPrefixes.includes(firstSegment)) continue;

      // Get the last segment as the slug
      const segments = innerPath.split('/').filter(Boolean);
      const slug = segments[segments.length - 1]?.toLowerCase();

      if (!slug || !postSlugs.has(slug)) continue;

      // Already prefixed?
      if (fullPath.startsWith('/guides/') || fullPath.startsWith('/blog/')) continue;

      const newPath = `/guides${fullPath.endsWith('/') ? fullPath : fullPath + '/'}`;

      // Handle multi-segment paths — only prefix if it's a simple /slug/ link
      // For paths like /male-q/sex/ we skip (those are site pages, not blog slugs)
      // But for /best-lubes/ or /how-to-bottom-without-pain/ we prefix
      if (segments.length === 1) {
        replacements.set(`href="${fullPath}"`, `href="${newPath}"`);
      }
    }

    for (const [oldStr, newStr] of replacements) {
      content = content.replaceAll(oldStr, newStr);
      modified = true;
      totalReplacements++;
      changes.push({
        postId: row.ID,
        title: row.post_title,
        from: oldStr,
        to: newStr,
      });
    }

    if (modified && apply) {
      await db.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [content, row.ID]);
      totalPosts++;
    } else if (modified) {
      totalPosts++;
    }
  }

  // Also fix comments
  console.log('Scanning comments...');
  const [commentRows] = await db.query<any[]>(
    `SELECT comment_ID, comment_content FROM wp_comments
     WHERE comment_content REGEXP 'href="\/[a-z]'`
  );

  let commentUpdates = 0;
  for (const row of commentRows) {
    let content: string = row.comment_content;
    let modified = false;
    const linkRe = /href="(\/([a-z0-9][\w-]*)\/?)"/gi;
    let match;

    while ((match = linkRe.exec(content)) !== null) {
      const fullPath = match[1];
      const slug = match[2].toLowerCase();

      if (skipPrefixes.includes(slug)) continue;
      if (!postSlugs.has(slug)) continue;
      if (fullPath.startsWith('/guides/') || fullPath.startsWith('/blog/')) continue;

      const newPath = `/guides${fullPath.endsWith('/') ? fullPath : fullPath + '/'}`;
      content = content.replaceAll(`href="${fullPath}"`, `href="${newPath}"`);
      modified = true;
    }

    if (modified) {
      commentUpdates++;
      if (apply) {
        await db.query('UPDATE wp_comments SET comment_content = ? WHERE comment_ID = ?', [content, row.comment_ID]);
      }
    }
  }

  // Report
  console.log(`\n${'='.repeat(70)}`);
  console.log(dryRun ? 'DRY RUN' : 'APPLIED');
  console.log(`${'='.repeat(70)}\n`);
  console.log(`  Blog links prefixed: ${totalReplacements}`);
  console.log(`  Posts affected: ${totalPosts}`);
  console.log(`  Comments affected: ${commentUpdates}`);

  if (changes.length > 0) {
    console.log(`\n  Sample changes:`);
    // Show unique from→to
    const uniqueChanges = new Map<string, string>();
    for (const c of changes) {
      if (uniqueChanges.size >= 30) break;
      uniqueChanges.set(c.from, c.to);
    }
    for (const [from, to] of uniqueChanges) {
      console.log(`    ${from}  →  ${to}`);
    }
    if (changes.length > 30) console.log(`    ... and ${changes.length - 30} more`);
  }

  // Validation: check no bare /slug/ links remain for known blog posts
  if (apply) {
    console.log('\n--- POST-APPLY VALIDATION ---\n');

    const [checkRows] = await db.query<any[]>(
      `SELECT ID, post_title, post_content FROM wp_posts
       WHERE post_status = 'publish' AND post_content REGEXP 'href="\/[a-z]'`
    );

    let remainingBare = 0;
    for (const row of checkRows) {
      const linkRe = /href="\/([\w-]+)\/?\s*"/gi;
      let m;
      while ((m = linkRe.exec(row.post_content)) !== null) {
        const slug = m[1].toLowerCase();
        if (skipPrefixes.includes(slug)) continue;
        if (postSlugs.has(slug)) {
          remainingBare++;
          if (remainingBare <= 5) {
            console.log(`  REMAINING: Post ${row.ID} "${row.post_title}" — href="/${slug}/"`);
          }
        }
      }
    }

    if (remainingBare === 0) {
      console.log('  [PASS] No bare blog slug links remain — all prefixed with /guides/.');
    } else {
      console.log(`\n  [WARN] ${remainingBare} bare blog slug links still found.`);
    }
  }

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
