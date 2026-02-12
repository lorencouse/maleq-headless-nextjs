/**
 * Analyze maleq.com links in post_content to categorize by URL type
 * (product, shop/category, page, blog cross-link, email, image, etc.)
 */
import { getConnection } from './lib/db';

interface LinkInfo {
  postId: number;
  postTitle: string;
  postType: string;
  url: string;
  category: string;
}

function categorizeUrl(url: string): string {
  // Email
  if (url.startsWith('mailto:')) return 'email';
  // Images / uploads
  if (/\/wp-content\/uploads\//i.test(url)) return 'image/upload';
  // Product pages
  if (/\/product\//i.test(url)) return 'product-page';
  // Product category / shop
  if (/\/product-category\//i.test(url)) return 'product-category';
  if (/\/shop\b/i.test(url)) return 'shop-page';
  // Cart/checkout/account
  if (/\/(cart|checkout|my-account)\b/i.test(url)) return 'cart/checkout/account';
  // Known site pages
  if (/\/(about|contact|privacy|terms|faq|shipping|returns)/i.test(url)) return 'site-page';
  // Blog tag/category archive
  if (/\/(tag|category)\//i.test(url)) return 'blog-taxonomy';
  // If it has maleq.com with a path, likely a blog post cross-link
  if (/maleq\.com\/[^?\s"'<>]+/i.test(url)) return 'blog-crosslink';
  // Just domain root
  if (/maleq\.com\/?(\?|$|#|")/i.test(url)) return 'homepage';
  return 'other';
}

async function main() {
  const db = await getConnection();

  // Extract all maleq.com URLs from post_content
  console.log('Extracting all maleq.com URLs from wp_posts.post_content...\n');

  const [rows] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, post_status, post_content
     FROM wp_posts
     WHERE post_content LIKE '%maleq.com%'
       AND post_status = 'publish'`
  );

  const allLinks: LinkInfo[] = [];

  // Regex to find URLs containing maleq.com (in href, src, or plain text)
  const urlRegex = /(?:href|src|content)=["']([^"']*maleq\.com[^"']*)["']|(?:mailto:[^\s"'<>]*maleq\.com[^\s"'<>]*)/gi;

  for (const row of rows) {
    const content: string = row.post_content || '';
    let match;
    const seen = new Set<string>();

    // Reset regex
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(content)) !== null) {
      const url = match[1] || match[0];
      if (seen.has(url)) continue;
      seen.add(url);

      allLinks.push({
        postId: row.ID,
        postTitle: row.post_title,
        postType: row.post_type,
        url,
        category: categorizeUrl(url),
      });
    }

    // Also catch plain-text maleq.com URLs not in attributes
    const plainUrlRegex = /https?:\/\/(?:www\.)?maleq\.com[^\s"'<>)}\]]*|mailto:[^\s"'<>]*maleq\.com[^\s"'<>]*/gi;
    plainUrlRegex.lastIndex = 0;
    while ((match = plainUrlRegex.exec(content)) !== null) {
      const url = match[0];
      if (seen.has(url)) continue;
      seen.add(url);
      allLinks.push({
        postId: row.ID,
        postTitle: row.post_title,
        postType: row.post_type,
        url,
        category: categorizeUrl(url),
      });
    }
  }

  // Also check postmeta (schema, oembeds)
  console.log('Checking wp_postmeta...');
  const [metaRows] = await db.query<any[]>(
    `SELECT pm.post_id, pm.meta_key, pm.meta_value, p.post_title, p.post_type
     FROM wp_postmeta pm
     JOIN wp_posts p ON p.ID = pm.post_id
     WHERE pm.meta_value LIKE '%maleq.com%'`
  );

  const metaLinks: { postId: number; metaKey: string; postTitle: string; url: string; category: string }[] = [];
  for (const row of metaRows) {
    const val: string = row.meta_value || '';
    const plainUrlRegex = /https?:\/\/(?:www\.)?maleq\.com[^\s"'<>)}\]\\]*/gi;
    let match;
    const seen = new Set<string>();
    while ((match = plainUrlRegex.exec(val)) !== null) {
      const url = match[0];
      if (seen.has(url)) continue;
      seen.add(url);
      metaLinks.push({
        postId: row.post_id,
        metaKey: row.meta_key,
        postTitle: row.post_title,
        url,
        category: categorizeUrl(url),
      });
    }
  }

  // Check wp_options
  console.log('Checking wp_options...');
  const [optRows] = await db.query<any[]>(
    `SELECT option_name, option_value FROM wp_options WHERE option_value LIKE '%maleq.com%'`
  );

  // Check wp_comments
  console.log('Checking wp_comments...');
  const [commentRows] = await db.query<any[]>(
    `SELECT comment_ID, comment_author, comment_content, comment_author_url
     FROM wp_comments
     WHERE comment_content LIKE '%maleq.com%' OR comment_author_url LIKE '%maleq.com%'`
  );

  await db.end();

  // ===== REPORT =====
  console.log(`\n${'='.repeat(80)}`);
  console.log('LINK ANALYSIS REPORT');
  console.log(`${'='.repeat(80)}\n`);

  // Group by category
  const byCategory = new Map<string, LinkInfo[]>();
  for (const link of allLinks) {
    if (!byCategory.has(link.category)) byCategory.set(link.category, []);
    byCategory.get(link.category)!.push(link);
  }

  // Sort categories by count desc
  const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log('--- POST CONTENT LINKS ---\n');
  for (const [cat, links] of sorted) {
    const uniqueUrls = new Set(links.map(l => l.url));
    const affectedPosts = new Set(links.map(l => l.postId));
    console.log(`[${cat.toUpperCase()}] ${links.length} links (${uniqueUrls.size} unique URLs, ${affectedPosts.size} posts)`);

    if (cat === 'email') {
      // Just show unique emails
      for (const u of uniqueUrls) console.log(`    ${u}`);
    } else {
      // Show unique URLs
      const urlCounts = new Map<string, number>();
      for (const l of links) urlCounts.set(l.url, (urlCounts.get(l.url) || 0) + 1);
      const sortedUrls = [...urlCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [url, count] of sortedUrls.slice(0, 30)) {
        console.log(`    ${count > 1 ? `(${count}x) ` : ''}${url.substring(0, 120)}`);
      }
      if (sortedUrls.length > 30) console.log(`    ... and ${sortedUrls.length - 30} more unique URLs`);
    }
    console.log();
  }

  // Postmeta
  if (metaLinks.length > 0) {
    console.log('\n--- POSTMETA LINKS ---\n');
    const byKey = new Map<string, typeof metaLinks>();
    for (const m of metaLinks) {
      if (!byKey.has(m.metaKey)) byKey.set(m.metaKey, []);
      byKey.get(m.metaKey)!.push(m);
    }
    for (const [key, links] of byKey) {
      const cats = new Map<string, number>();
      for (const l of links) cats.set(l.category, (cats.get(l.category) || 0) + 1);
      const catStr = [...cats.entries()].map(([c, n]) => `${c}: ${n}`).join(', ');
      console.log(`  meta_key: ${key} — ${links.length} URLs (${catStr})`);
      for (const l of links.slice(0, 5)) {
        console.log(`    post ${l.postId}: ${l.url.substring(0, 100)}`);
      }
      if (links.length > 5) console.log(`    ... and ${links.length - 5} more`);
    }
  }

  // Options
  if (optRows.length > 0) {
    console.log('\n--- WP_OPTIONS ---\n');
    for (const row of optRows) {
      const val = String(row.option_value);
      // Extract just the maleq.com URLs
      const urls = val.match(/https?:\/\/(?:www\.)?maleq\.com[^\s"'<>)}\]\\]*/gi) || [];
      console.log(`  ${row.option_name}: ${urls.length > 0 ? urls.slice(0, 3).join(', ') : val.substring(0, 80)}`);
    }
  }

  // Comments
  if (commentRows.length > 0) {
    console.log('\n--- WP_COMMENTS ---\n');
    for (const row of commentRows) {
      if (row.comment_author_url?.includes('maleq.com')) {
        console.log(`  Comment ${row.comment_ID} by ${row.comment_author} — author_url: ${row.comment_author_url}`);
      }
      if (row.comment_content?.includes('maleq.com')) {
        const match = row.comment_content.match(/https?:\/\/(?:www\.)?maleq\.com[^\s"'<>)}\]]*/gi);
        if (match) {
          console.log(`  Comment ${row.comment_ID} by ${row.comment_author} — content URLs: ${match.slice(0, 3).join(', ')}`);
        }
      }
    }
  }

  // Final summary — what needs action
  console.log(`\n${'='.repeat(80)}`);
  console.log('ACTION SUMMARY — Links that reference old URL paths');
  console.log(`${'='.repeat(80)}\n`);

  const actionable = ['product-page', 'product-category', 'shop-page', 'cart/checkout/account', 'site-page', 'blog-crosslink', 'blog-taxonomy', 'homepage'];
  let totalActionable = 0;
  for (const cat of actionable) {
    const links = byCategory.get(cat);
    if (links) {
      const uniqueUrls = new Set(links.map(l => l.url));
      const affectedPosts = new Set(links.map(l => l.postId));
      console.log(`  ${cat}: ${links.length} links in ${affectedPosts.size} posts (${uniqueUrls.size} unique URLs)`);
      totalActionable += links.length;
    }
  }

  const skip = ['email', 'image/upload'];
  console.log(`\n  SKIPPABLE (no action needed):`);
  for (const cat of skip) {
    const links = byCategory.get(cat);
    if (links) console.log(`    ${cat}: ${links.length} links (keeping as-is)`);
  }

  console.log(`\n  TOTAL ACTIONABLE: ${totalActionable} links in post_content`);
  console.log(`  POSTMETA: ${metaLinks.length} links`);
  console.log(`  OPTIONS: ${optRows.length} entries`);
  console.log(`  COMMENTS: ${commentRows.length} entries`);
}

main().catch(err => { console.error(err); process.exit(1); });
