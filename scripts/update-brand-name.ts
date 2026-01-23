#!/usr/bin/env bun

/**
 * Update Brand Name Script
 *
 * Safely updates "Maleq" to "Male Q" in the WordPress database.
 * Only updates text content, not URLs, file paths, or serialized data.
 *
 * Usage:
 *   bun scripts/update-brand-name.ts [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes (default)
 *   --execute    Actually perform the updates
 */

import mysql from 'mysql2/promise';

// Configuration - LocalWP MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

// Brand name variations to replace
const REPLACEMENTS = [
  { old: 'Maleq', new: 'Male Q' },
  { old: 'MaleQ', new: 'Male Q' },
  { old: 'MALEQ', new: 'MALE Q' },
];

// Options that are safe to update (text content, not URLs)
const SAFE_OPTIONS = [
  'blogname',
  'blogdescription',
];

// Options to NEVER update (URLs, paths, serialized data)
const UNSAFE_OPTIONS = [
  'siteurl',
  'home',
  'upload_path',
  'upload_url_path',
  'permalink_structure',
];

// Meta keys to skip (social handles, URLs, etc.)
const SKIP_META_KEYS = [
  '_publicize_twitter_user',
  '_wp_old_slug',
  'twitter',
  'facebook',
  'instagram',
];

// Helper to apply all replacements
function applyReplacements(text: string): string {
  let result = text;
  for (const { old, new: newVal } of REPLACEMENTS) {
    result = result.replace(new RegExp(old, 'g'), newVal);
  }
  return result;
}

// Check if text contains any old brand names
function containsOldBrand(text: string): boolean {
  return REPLACEMENTS.some(({ old }) => text.includes(old));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Use --execute to perform actual updates\n');
  } else {
    console.log('⚠️  EXECUTE MODE - Changes will be made to the database\n');
  }

  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('✓ Connected to database\n');

  try {
    let totalUpdates = 0;

    // 1. Update wp_options (safe options only)
    console.log('📋 Checking wp_options...');
    const [options] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT option_id, option_name, option_value
       FROM wp_options
       WHERE option_name IN (?)
       AND (option_value LIKE '%Maleq%' OR option_value LIKE '%MaleQ%' OR option_value LIKE '%MALEQ%')`,
      [SAFE_OPTIONS]
    );

    if (options.length > 0) {
      console.log(`   Found ${options.length} option(s) to update:`);
      for (const opt of options) {
        if (!containsOldBrand(opt.option_value)) continue;
        const newValue = applyReplacements(opt.option_value);
        console.log(`   - ${opt.option_name}: "${opt.option_value}" → "${newValue}"`);

        if (!dryRun) {
          await connection.query(
            'UPDATE wp_options SET option_value = ? WHERE option_id = ?',
            [newValue, opt.option_id]
          );
        }
        totalUpdates++;
      }
    } else {
      console.log('   No options to update');
    }

    // 2. Update wp_posts (titles, content, excerpts - but not guids or URLs in content)
    console.log('\n📄 Checking wp_posts...');

    // First, find posts with brand name in title or excerpt
    const [postsTitleExcerpt] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ID, post_title, post_excerpt
       FROM wp_posts
       WHERE (post_title LIKE '%Maleq%' OR post_title LIKE '%MaleQ%'
              OR post_excerpt LIKE '%Maleq%' OR post_excerpt LIKE '%MaleQ%')
       AND post_status != 'auto-draft'`
    );

    if (postsTitleExcerpt.length > 0) {
      console.log(`   Found ${postsTitleExcerpt.length} post(s) with brand name in title/excerpt:`);
      for (const post of postsTitleExcerpt) {
        if (containsOldBrand(post.post_title)) {
          const newTitle = applyReplacements(post.post_title);
          console.log(`   - Post ${post.ID} title: "${post.post_title}" → "${newTitle}"`);

          if (!dryRun) {
            await connection.query(
              'UPDATE wp_posts SET post_title = ? WHERE ID = ?',
              [newTitle, post.ID]
            );
          }
          totalUpdates++;
        }
        if (post.post_excerpt && containsOldBrand(post.post_excerpt)) {
          const newExcerpt = applyReplacements(post.post_excerpt);
          console.log(`   - Post ${post.ID} excerpt updated`);

          if (!dryRun) {
            await connection.query(
              'UPDATE wp_posts SET post_excerpt = ? WHERE ID = ?',
              [newExcerpt, post.ID]
            );
          }
          totalUpdates++;
        }
      }
    } else {
      console.log('   No post titles/excerpts to update');
    }

    // Update post_content, but be careful with URLs
    const [postsContent] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ID, post_content
       FROM wp_posts
       WHERE (post_content LIKE '%Maleq%' OR post_content LIKE '%MaleQ%')
       AND post_content NOT LIKE '%maleq.com%'
       AND post_content NOT LIKE '%maleq.org%'
       AND post_status != 'auto-draft'`
    );

    // For posts that might have both brand mentions and URLs, handle carefully
    const [postsContentWithUrls] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ID, post_content
       FROM wp_posts
       WHERE (post_content LIKE '%Maleq%' OR post_content LIKE '%MaleQ%')
       AND (post_content LIKE '%maleq.com%' OR post_content LIKE '%maleq.org%')
       AND post_status != 'auto-draft'`
    );

    if (postsContent.length > 0) {
      console.log(`   Found ${postsContent.length} post(s) with brand name in content (no URLs):`);
      for (const post of postsContent) {
        if (!containsOldBrand(post.post_content)) continue;
        const newContent = applyReplacements(post.post_content);
        console.log(`   - Post ${post.ID} content updated`);

        if (!dryRun) {
          await connection.query(
            'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
            [newContent, post.ID]
          );
        }
        totalUpdates++;
      }
    }

    if (postsContentWithUrls.length > 0) {
      console.log(`\n   ⚠️  Found ${postsContentWithUrls.length} post(s) with brand name AND URLs - skipping to avoid breaking links`);
      console.log('      These may need manual review.');
    }

    // 3. Update wp_postmeta (but not serialized data, URLs, or social handles)
    console.log('\n📎 Checking wp_postmeta...');
    const skipKeysPattern = SKIP_META_KEYS.map(k => `meta_key NOT LIKE '%${k}%'`).join(' AND ');
    const [postmeta] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT meta_id, post_id, meta_key, meta_value
       FROM wp_postmeta
       WHERE (meta_value LIKE '%Maleq%' OR meta_value LIKE '%MaleQ%')
       AND meta_value NOT LIKE 'a:%'
       AND meta_value NOT LIKE 'O:%'
       AND meta_value NOT LIKE '%://%'
       AND meta_value NOT LIKE '@%'
       AND meta_key NOT LIKE '%url%'
       AND meta_key NOT LIKE '%path%'
       AND meta_key NOT LIKE '%_file%'
       AND ${skipKeysPattern}`
    );

    if (postmeta.length > 0) {
      console.log(`   Found ${postmeta.length} meta value(s) to update:`);
      for (const meta of postmeta) {
        if (!containsOldBrand(meta.meta_value)) continue;
        const newValue = applyReplacements(meta.meta_value);
        console.log(`   - Post ${meta.post_id} meta "${meta.meta_key}": "${meta.meta_value.substring(0, 50)}..." → "${newValue.substring(0, 50)}..."`);

        if (!dryRun) {
          await connection.query(
            'UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?',
            [newValue, meta.meta_id]
          );
        }
        totalUpdates++;
      }
    } else {
      console.log('   No postmeta to update (after filtering social handles)');
    }

    // 4. Update wp_terms (category/tag names)
    console.log('\n🏷️  Checking wp_terms...');
    const [terms] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT term_id, name FROM wp_terms
       WHERE (name LIKE '%Maleq%' OR name LIKE '%MaleQ%')`
    );

    if (terms.length > 0) {
      console.log(`   Found ${terms.length} term(s) to check:`);
      for (const term of terms) {
        if (!containsOldBrand(term.name)) {
          console.log(`   - Term ${term.term_id}: "${term.name}" - no change needed`);
          continue;
        }
        const newName = applyReplacements(term.name);
        console.log(`   - Term ${term.term_id}: "${term.name}" → "${newName}"`);

        if (!dryRun) {
          await connection.query(
            'UPDATE wp_terms SET name = ? WHERE term_id = ?',
            [newName, term.term_id]
          );
        }
        totalUpdates++;
      }
    } else {
      console.log('   No terms to update');
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (dryRun) {
      console.log(`📊 DRY RUN COMPLETE: ${totalUpdates} update(s) would be made`);
      console.log('   Run with --execute to apply changes');
    } else {
      console.log(`✅ COMPLETE: ${totalUpdates} update(s) made`);
    }

  } finally {
    await connection.end();
    console.log('\n✓ Database connection closed');
  }
}

main().catch(console.error);
