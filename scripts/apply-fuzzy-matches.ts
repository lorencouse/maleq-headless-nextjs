#!/usr/bin/env bun

/**
 * Apply Fuzzy Match Selections
 *
 * Reads the product-link-mapping.md file and applies any checked fuzzy match
 * selections to the WordPress database.
 *
 * Usage:
 *   bun scripts/apply-fuzzy-matches.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes (default)
 *   --execute    Actually perform the updates
 */

import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'fs';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const REPORT_PATH = '/Volumes/Mac Mini M4 -2TB/MacMini-Data/Documents/web-dev/maleq-headless/docs/product-link-mapping.md';

interface ApprovedMatch {
  oldSlug: string;
  newSlug: string | null; // null means REMOVE
}

function parseApprovedMatches(content: string): ApprovedMatch[] {
  const matches: ApprovedMatch[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Look for checked boxes: - [x] or - [X]
    const checkedMatch = line.match(/^-\s*\[x\]\s*/i);
    if (!checkedMatch) continue;

    // Check if it's a REMOVE action
    if (line.includes('**REMOVE**')) {
      const removeMatch = line.match(/Delete all links to `([^`]+)`/);
      if (removeMatch) {
        matches.push({
          oldSlug: removeMatch[1],
          newSlug: null,
        });
      }
      continue;
    }

    // Parse replacement: `old-slug` → `new-slug`
    const replacementMatch = line.match(/`([^`]+)`\s*→\s*`([^`]+)`/);
    if (replacementMatch) {
      matches.push({
        oldSlug: replacementMatch[1],
        newSlug: replacementMatch[2],
      });
    }
  }

  return matches;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('🔗 Apply Fuzzy Match Selections');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Use --execute to perform actual updates\n');
  } else {
    console.log('⚠️  EXECUTE MODE - Changes will be made to the database\n');
  }

  // Read and parse the report file
  console.log('📄 Reading approved matches from report...');
  let reportContent: string;
  try {
    reportContent = readFileSync(REPORT_PATH, 'utf-8');
  } catch (error) {
    console.error(`Error reading report file: ${REPORT_PATH}`);
    process.exit(1);
  }

  const approvedMatches = parseApprovedMatches(reportContent);

  if (approvedMatches.length === 0) {
    console.log('\n❌ No approved matches found.');
    console.log('   Check the boxes in the markdown file next to the matches you want to apply.');
    console.log('   Example: - [x] `old-slug` → `new-slug`');
    process.exit(0);
  }

  console.log(`\n✓ Found ${approvedMatches.length} approved matches:\n`);

  const replacements = approvedMatches.filter(m => m.newSlug !== null);
  const removals = approvedMatches.filter(m => m.newSlug === null);

  if (replacements.length > 0) {
    console.log('Replacements:');
    for (const match of replacements) {
      console.log(`  ${match.oldSlug} → ${match.newSlug}`);
    }
  }

  if (removals.length > 0) {
    console.log('\nRemovals:');
    for (const match of removals) {
      console.log(`  ${match.oldSlug} (will be removed)`);
    }
  }

  // Connect to database
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('\n✓ Connected to database');

  try {
    // Load products to get SKUs for replacements
    const [products] = await connection.execute(`
      SELECT
        p.ID as id,
        p.post_name as slug,
        p.post_title as name,
        MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) as sku
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
      WHERE p.post_type IN ('product', 'product_variation')
      AND p.post_status = 'publish'
      GROUP BY p.ID
    `) as [any[], any];

    const productBySlug = new Map<string, any>();
    for (const p of products) {
      if (p.slug) {
        productBySlug.set(p.slug.toLowerCase(), p);
      }
    }

    // Get posts with old-format links
    const [posts] = await connection.execute(`
      SELECT ID, post_title, post_content
      FROM wp_posts
      WHERE post_type IN ('post', 'wp_block')
      AND post_status = 'publish'
      AND post_content LIKE '%maleq%/product/%'
    `) as [any[], any];

    console.log(`\n📝 Processing ${posts.length} posts...\n`);

    let updatedPosts = 0;
    let totalReplacements = 0;
    let totalRemovals = 0;

    for (const post of posts) {
      let content = post.post_content;
      let modified = false;

      for (const match of approvedMatches) {
        // Build regex to match old URLs with this slug
        const oldUrlPattern = new RegExp(
          `https?://[^"'\\s<>]*(?:maleq[^"'\\s<>]*|maleq-local\\.local)/product/${match.oldSlug}[^"'\\s<>]*`,
          'gi'
        );

        const matches = content.match(oldUrlPattern);
        if (!matches) continue;

        if (match.newSlug === null) {
          // REMOVE: Replace link with just the anchor text or remove entirely
          // For now, replace with empty string (you might want to handle this differently)
          for (const oldUrl of matches) {
            // If it's in an <a> tag, try to preserve the link text
            const linkPattern = new RegExp(
              `<a[^>]*href=["']${oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([^<]*)</a>`,
              'gi'
            );
            content = content.replace(linkPattern, '$1');
            // Also replace bare URLs
            content = content.split(oldUrl).join('');
            totalRemovals++;
          }
          modified = true;
        } else {
          // REPLACE: Update to new product URL
          const product = productBySlug.get(match.newSlug.toLowerCase());
          if (product) {
            const newUrl = `/product/${product.slug}`;
            for (const oldUrl of matches) {
              content = content.split(oldUrl).join(newUrl);
              totalReplacements++;
            }
            modified = true;
          }
        }
      }

      if (modified) {
        updatedPosts++;
        if (!dryRun) {
          await connection.execute(
            'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
            [content, post.ID]
          );
        }
      }
    }

    console.log('='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));
    console.log(`Posts updated:     ${updatedPosts}`);
    console.log(`URLs replaced:     ${totalReplacements}`);
    console.log(`URLs removed:      ${totalRemovals}`);

    if (!dryRun && updatedPosts > 0) {
      console.log('\n✅ Changes applied to database');

      // Uncheck the applied matches in the report
      let updatedReport = reportContent;
      for (const match of approvedMatches) {
        if (match.newSlug === null) {
          // Uncheck REMOVE entries
          const pattern = new RegExp(
            `- \\[x\\] \\*\\*REMOVE\\*\\* - Delete all links to \`${match.oldSlug}\``,
            'gi'
          );
          updatedReport = updatedReport.replace(pattern,
            `- [x] ~~**REMOVE** - Delete all links to \`${match.oldSlug}\`~~ ✅ APPLIED`
          );
        } else {
          // Uncheck replacement entries
          const pattern = new RegExp(
            `- \\[x\\] \`${match.oldSlug}\` → \`${match.newSlug}\``,
            'gi'
          );
          updatedReport = updatedReport.replace(pattern,
            `- [x] ~~\`${match.oldSlug}\` → \`${match.newSlug}\`~~ ✅ APPLIED`
          );
        }
      }
      writeFileSync(REPORT_PATH, updatedReport);
      console.log('📄 Report updated with applied status');
    }

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

main().catch(console.error);
