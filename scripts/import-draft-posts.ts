#!/usr/bin/env bun

/**
 * Import draft/private posts from old-db.sql into local WordPress database.
 * Extracts specific posts by slug from the old SQL dump and inserts them.
 *
 * Usage:
 *   bun scripts/import-draft-posts.ts --dry-run          # Preview what would be imported
 *   bun scripts/import-draft-posts.ts --apply             # Actually import
 *   bun scripts/import-draft-posts.ts --list-drafts       # List all draft/private posts in old-db.sql
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { getConnection } from './lib/db';

const OLD_DB_PATH = 'scripts/old-db.sql';

// Slugs to import - English only
const TARGET_SLUGS = new Set([
  'best-dildo-for-women',
  'the-best-fleshlight-the-top-male-masturbators-of-all-time',
  'best-female-rabbit-vibrators-for-clitoral-orgasms-in-2023',
  'hot-sexy-gay-halloween-costumes-2016',
  'sexy-gay-halloween-costumes-2016',
  'homosexuality-exist-first-place',
  'anal-sex-positions',
  'foreplay-fun-spots',
  'guys-date-less-satisfied-become',
  'leaked-pics-of-red-sox-player-grady-sizemore-will-make-your-mouth-water',
  'the-hottest-swimmers-we-wish-were-gay',
  'this-hot-bel-ami-photoshoot-will-make-your-mouth-water',
]);

interface ParsedPost {
  ID: number;
  post_author: number;
  post_date: string;
  post_date_gmt: string;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_status: string;
  post_name: string;
  post_type: string;
  post_modified: string;
  post_modified_gmt: string;
  post_parent: number;
  comment_status: string;
  ping_status: string;
  guid: string;
}

// WordPress wp_posts column order (standard mysqldump)
const WP_POSTS_COLUMNS = [
  'ID', 'post_author', 'post_date', 'post_date_gmt', 'post_content',
  'post_title', 'post_excerpt', 'post_status', 'comment_status', 'ping_status',
  'post_password', 'post_name', 'to_ping', 'pinged', 'post_modified',
  'post_modified_gmt', 'post_content_filtered', 'post_parent', 'guid',
  'menu_order', 'post_type', 'post_mime_type', 'comment_count'
];

function parseTupleFields(tuple: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < tuple.length; i++) {
    const char = tuple[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      if (!inString) {
        inString = true;
      } else {
        inString = false;
      }
      continue;
    }

    if (char === ',' && !inString) {
      fields.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function unescapeSql(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

async function extractPostsFromOldDb(
  targetSlugs: Set<string> | null
): Promise<Map<string, ParsedPost>> {
  const posts = new Map<string, ParsedPost>();

  const fileStream = createReadStream(OLD_DB_PATH);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let inPostsInsert = false;
  let buffer = '';
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount % 500000 === 0) {
      process.stdout.write(`  Scanning line ${lineCount}...\r`);
    }

    if (line.includes('INSERT INTO') && line.includes('_posts`') && !line.includes('_postmeta') && !line.includes('_poststats')) {
      inPostsInsert = true;
      buffer = line;
    } else if (inPostsInsert) {
      buffer += line;
      if (line.trimEnd().endsWith(';')) {
        processInsertStatement(buffer, posts, targetSlugs);
        inPostsInsert = false;
        buffer = '';
      }
    }
  }

  console.log(`  Scanned ${lineCount} lines`);
  return posts;
}

function processInsertStatement(
  sql: string,
  posts: Map<string, ParsedPost>,
  targetSlugs: Set<string> | null
): void {
  const valuesMatch = sql.match(/VALUES\s*(.+);$/s);
  if (!valuesMatch) return;

  const valuesStr = valuesMatch[1];

  // Split into tuples using state machine
  const tuples: string[] = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let current = '';

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !escapeNext) {
      inString = !inString;
      current += char;
      continue;
    }

    if (!inString) {
      if (char === '(') {
        if (depth === 0) current = '';
        else current += char;
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          tuples.push(current);
          current = '';
        } else {
          current += char;
        }
      } else if (depth > 0) {
        current += char;
      }
    } else {
      current += char;
    }
  }

  for (const tuple of tuples) {
    try {
      const fields = parseTupleFields(tuple);
      if (fields.length < 23) continue;

      const postType = unescapeSql(fields[20]); // post_type
      const postStatus = unescapeSql(fields[7]); // post_status
      const postName = unescapeSql(fields[11]); // post_name (slug)

      // For --list-drafts mode, collect all non-published posts
      if (targetSlugs === null) {
        if (postType === 'post' && postStatus !== 'publish' && postName) {
          posts.set(postName, {
            ID: parseInt(fields[0]),
            post_author: parseInt(fields[1]),
            post_date: unescapeSql(fields[2]),
            post_date_gmt: unescapeSql(fields[3]),
            post_content: unescapeSql(fields[4]),
            post_title: unescapeSql(fields[5]),
            post_excerpt: unescapeSql(fields[6]),
            post_status: postStatus,
            post_name: postName,
            post_type: postType,
            post_modified: unescapeSql(fields[14]),
            post_modified_gmt: unescapeSql(fields[15]),
            post_parent: parseInt(fields[17]),
            comment_status: unescapeSql(fields[8]),
            ping_status: unescapeSql(fields[9]),
            guid: unescapeSql(fields[18]),
          });
        }
        continue;
      }

      // For targeted import, only collect matching slugs
      if (targetSlugs.has(postName) && postType === 'post') {
        posts.set(postName, {
          ID: parseInt(fields[0]),
          post_author: parseInt(fields[1]),
          post_date: unescapeSql(fields[2]),
          post_date_gmt: unescapeSql(fields[3]),
          post_content: unescapeSql(fields[4]),
          post_title: unescapeSql(fields[5]),
          post_excerpt: unescapeSql(fields[6]),
          post_status: postStatus,
          post_name: postName,
          post_type: postType,
          post_modified: unescapeSql(fields[14]),
          post_modified_gmt: unescapeSql(fields[15]),
          post_parent: parseInt(fields[17]),
          comment_status: unescapeSql(fields[8]),
          ping_status: unescapeSql(fields[9]),
          guid: unescapeSql(fields[18]),
        });
      }
    } catch {
      // Skip malformed tuples
    }
  }
}

async function extractPostmeta(postIds: Set<number>): Promise<Map<number, Array<{ key: string; value: string }>>> {
  const meta = new Map<number, Array<{ key: string; value: string }>>();

  const fileStream = createReadStream(OLD_DB_PATH);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let inMetaInsert = false;
  let buffer = '';

  for await (const line of rl) {
    if (line.includes('INSERT INTO') && line.includes('_postmeta`')) {
      inMetaInsert = true;
      buffer = line;
    } else if (inMetaInsert) {
      buffer += line;
      if (line.trimEnd().endsWith(';')) {
        // Parse postmeta tuples
        const valuesMatch = buffer.match(/VALUES\s*(.+);$/s);
        if (valuesMatch) {
          // Simple regex to extract (meta_id, post_id, meta_key, meta_value) tuples
          const tupleRegex = /\((\d+),\s*(\d+),\s*'([^'\\]*(?:\\.[^'\\]*)*)',\s*'([^'\\]*(?:\\.[^'\\]*)*)'\)/g;
          let match;
          while ((match = tupleRegex.exec(valuesMatch[1])) !== null) {
            const postId = parseInt(match[2]);
            if (postIds.has(postId)) {
              if (!meta.has(postId)) meta.set(postId, []);
              meta.get(postId)!.push({
                key: unescapeSql(match[3]),
                value: unescapeSql(match[4]),
              });
            }
          }
        }
        inMetaInsert = false;
        buffer = '';
      }
    }
  }

  return meta;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  const listDrafts = process.argv.includes('--list-drafts');

  if (!dryRun && !apply && !listDrafts) {
    console.log('Usage:');
    console.log('  bun scripts/import-draft-posts.ts --list-drafts    # List draft/private posts in old-db.sql');
    console.log('  bun scripts/import-draft-posts.ts --dry-run        # Preview import');
    console.log('  bun scripts/import-draft-posts.ts --apply          # Import posts');
    process.exit(1);
  }

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Import Draft Posts from Old DB            ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (listDrafts) {
    console.log('Scanning old-db.sql for non-published posts...\n');
    const allDrafts = await extractPostsFromOldDb(null);

    console.log(`\nFound ${allDrafts.size} non-published posts:\n`);
    console.log('ID       | Status  | Slug');
    console.log('-'.repeat(80));
    for (const [slug, post] of [...allDrafts.entries()].sort((a, b) => a[1].post_date.localeCompare(b[1].post_date))) {
      const title = post.post_title.substring(0, 60);
      console.log(`${String(post.ID).padEnd(9)}| ${post.post_status.padEnd(8)}| ${slug}`);
      console.log(`         |         | "${title}"`);
      console.log(`         |         | ${post.post_date} | ${post.post_content.length} chars`);
    }
    return;
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Target slugs: ${[...TARGET_SLUGS].join(', ')}\n`);

  // Extract target posts
  console.log('Extracting posts from old-db.sql...');
  const posts = await extractPostsFromOldDb(TARGET_SLUGS);

  if (posts.size === 0) {
    console.log('No matching posts found in old-db.sql.');
    return;
  }

  console.log(`Found ${posts.size} post(s) to import\n`);

  // Extract postmeta for these posts
  const postIds = new Set([...posts.values()].map(p => p.ID));
  console.log('Extracting postmeta...');
  const postmeta = await extractPostmeta(postIds);
  console.log(`Found metadata for ${postmeta.size} post(s)\n`);

  // Connect to local DB
  const connection = await getConnection();
  console.log('Connected to local MySQL\n');

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const [slug, post] of posts) {
    console.log(`\n--- ${slug} ---`);
    console.log(`  Old ID: ${post.ID}`);
    console.log(`  Title: ${post.post_title}`);
    console.log(`  Status: ${post.post_status}`);
    console.log(`  Date: ${post.post_date}`);
    console.log(`  Content length: ${post.post_content.length} chars`);

    // Check if slug already exists
    const [existing] = await connection.execute(
      'SELECT ID, post_status FROM wp_posts WHERE post_name = ?',
      [slug]
    ) as any[];

    if (existing.length > 0) {
      console.log(`  SKIP: Already exists as ID ${existing[0].ID} (status: ${existing[0].post_status})`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log('  [DRY RUN] Would insert as draft');
      const meta = postmeta.get(post.ID) || [];
      console.log(`  Postmeta entries: ${meta.length}`);
      // Show key meta
      for (const m of meta.filter(m => ['_thumbnail_id', '_yoast_wpseo_title', '_yoast_wpseo_metadesc', 'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword'].includes(m.key))) {
        console.log(`    ${m.key}: ${m.value.substring(0, 100)}`);
      }
      imported++;
      continue;
    }

    try {
      // Insert the post as draft
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const [result] = await connection.execute(
        `INSERT INTO wp_posts (
          post_author, post_date, post_date_gmt, post_content, post_title,
          post_excerpt, post_status, comment_status, ping_status, post_password,
          post_name, to_ping, pinged, post_modified, post_modified_gmt,
          post_content_filtered, post_parent, guid, menu_order, post_type,
          post_mime_type, comment_count
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, '', ?, '', '', ?, ?, '', ?, ?, 0, 'post', '', 0)`,
        [
          post.post_author,
          post.post_date,
          // Fix invalid '0000-00-00 00:00:00' GMT dates - use post_date instead
          post.post_date_gmt === '0000-00-00 00:00:00' ? post.post_date : post.post_date_gmt,
          post.post_content,
          post.post_title,
          post.post_excerpt,
          post.comment_status,
          post.ping_status,
          post.post_name,
          now, // post_modified
          now, // post_modified_gmt
          post.post_parent,
          `http://maleq-local.local/?p=0`, // placeholder guid, WP updates on publish
        ]
      ) as any[];

      const newId = result.insertId;
      console.log(`  Inserted as ID ${newId} (draft)`);

      // Update guid with correct ID
      await connection.execute(
        'UPDATE wp_posts SET guid = ? WHERE ID = ?',
        [`http://maleq-local.local/?p=${newId}`, newId]
      );

      // Import postmeta
      const meta = postmeta.get(post.ID) || [];
      let metaCount = 0;
      for (const m of meta) {
        // Skip internal/cache meta that won't transfer correctly
        if (m.key.startsWith('_edit_lock') || m.key.startsWith('_edit_last')) continue;

        await connection.execute(
          'INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)',
          [newId, m.key, m.value]
        );
        metaCount++;
      }
      console.log(`  Imported ${metaCount} postmeta entries`);

      imported++;
    } catch (e) {
      console.error(`  ERROR:`, e);
      errors++;
    }
  }

  await connection.end();

  console.log('\n=== SUMMARY ===');
  console.log(`Imported: ${imported}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
