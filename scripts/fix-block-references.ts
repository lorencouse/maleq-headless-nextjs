#!/usr/bin/env bun

/**
 * Fix Block References Script
 *
 * Updates wp:block references in posts to point to the correct block IDs
 * after blocks were imported with new IDs.
 *
 * Usage:
 *   bun scripts/fix-block-references.ts [--dry-run]
 */

import mysql from 'mysql2/promise';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

const BACKUP_FILE = 'scripts/old-db.sql';

interface BlockInfo {
  id: number;
  title: string;
  slug: string;
}

async function extractBlocksFromBackup(backupPath: string): Promise<Map<number, BlockInfo>> {
  console.log(`📂 Reading backup file: ${backupPath}`);

  const blocks = new Map<number, BlockInfo>();

  const fileStream = createReadStream(backupPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inPostsInsert = false;
  let buffer = '';

  for await (const line of rl) {
    if (line.match(/^INSERT INTO `[^`]*_posts`/)) {
      inPostsInsert = true;
      buffer = line;
    } else if (inPostsInsert) {
      buffer += '\n' + line;
      if (line.endsWith(';')) {
        parseInsertStatement(buffer, blocks);
        inPostsInsert = false;
        buffer = '';
      }
    }
  }

  return blocks;
}

function parseInsertStatement(sql: string, blocks: Map<number, BlockInfo>): void {
  const valuesMatch = sql.match(/VALUES\s*(.+);$/s);
  if (!valuesMatch) return;

  const valuesStr = valuesMatch[1];
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
        } else current += char;
      } else if (depth > 0) current += char;
    } else current += char;
  }

  for (const tuple of tuples) {
    try {
      const fields = parseTupleFields(tuple);
      if (fields.length >= 23) {
        const postType = unescapeSqlString(fields[20]);
        if (postType === 'wp_block') {
          const id = parseInt(fields[0], 10);
          const title = unescapeSqlString(fields[5]);
          const slug = unescapeSqlString(fields[11]);
          blocks.set(id, { id, title, slug });
        }
      }
    } catch (e) {}
  }
}

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
      escapeNext = true;
      current += char;
      continue;
    }

    if (char === "'") {
      inString = !inString;
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

function unescapeSqlString(s: string): string {
  if (s === 'NULL') return '';
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Fix Block References in Posts                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    console.log('Mode: DRY RUN\n');
  }

  // Step 1: Extract blocks from old database backup
  const oldBlocks = await extractBlocksFromBackup(BACKUP_FILE);
  console.log(`📦 Found ${oldBlocks.size} blocks in old database\n`);

  // Step 2: Connect to local database and get current blocks
  const connection = await mysql.createConnection({
    socketPath: LOCAL_MYSQL_SOCKET,
    user: LOCAL_DB_USER,
    password: LOCAL_DB_PASS,
    database: LOCAL_DB_NAME,
  });

  console.log('✓ Connected to MySQL\n');

  const [currentBlocks] = await connection.execute(
    "SELECT ID, post_title, post_name FROM wp_posts WHERE post_type = 'wp_block'"
  ) as [any[], any];

  console.log(`📋 Found ${currentBlocks.length} blocks in local DB\n`);

  // Step 3: Build mapping from old ID -> new ID based on title/slug match
  const idMapping = new Map<number, number>();

  // Create lookup by title and slug
  const byTitle = new Map<string, number>();
  const bySlug = new Map<string, number>();

  for (const block of currentBlocks) {
    if (block.post_title) byTitle.set(block.post_title.toLowerCase(), block.ID);
    if (block.post_name) bySlug.set(block.post_name.toLowerCase(), block.ID);
  }

  // Also check if old ID exists directly
  const currentIds = new Set(currentBlocks.map((b: any) => b.ID));

  for (const [oldId, oldBlock] of oldBlocks) {
    // First check if old ID exists as wp_block
    if (currentIds.has(oldId)) {
      idMapping.set(oldId, oldId); // Same ID
    } else {
      // Try to find by title
      const newIdByTitle = byTitle.get(oldBlock.title.toLowerCase());
      if (newIdByTitle) {
        idMapping.set(oldId, newIdByTitle);
      } else {
        // Try by slug
        const newIdBySlug = bySlug.get(oldBlock.slug.toLowerCase());
        if (newIdBySlug) {
          idMapping.set(oldId, newIdBySlug);
        }
      }
    }
  }

  console.log(`🔗 Created ID mapping for ${idMapping.size} blocks\n`);

  // Step 4: Get all referenced block IDs from posts
  const [postsWithBlocks] = await connection.execute(
    `SELECT ID, post_title, post_type, post_content FROM wp_posts
     WHERE post_content LIKE '%wp:block {"ref"%'
     AND post_type IN ('post', 'page', 'product')`
  ) as [any[], any];

  console.log(`📄 Found ${postsWithBlocks.length} posts with block references\n`);

  // Step 5: Find all broken references
  const brokenRefs = new Map<number, Set<number>>(); // refId -> set of post IDs
  const refRegex = /"ref":(\d+)/g;

  for (const post of postsWithBlocks) {
    let match;
    while ((match = refRegex.exec(post.post_content)) !== null) {
      const refId = parseInt(match[1], 10);
      // Check if this ref is broken (not in current blocks)
      if (!currentIds.has(refId)) {
        if (!brokenRefs.has(refId)) {
          brokenRefs.set(refId, new Set());
        }
        brokenRefs.get(refId)!.add(post.ID);
      }
    }
  }

  console.log(`❌ Found ${brokenRefs.size} broken block references\n`);

  // Show broken refs and their mappings
  console.log('Broken references and their mappings:');
  let fixable = 0;
  let unfixable = 0;

  for (const [oldId, postIds] of brokenRefs) {
    const newId = idMapping.get(oldId);
    const oldBlockInfo = oldBlocks.get(oldId);
    const title = oldBlockInfo?.title || '(unknown)';

    if (newId) {
      console.log(`  ✅ ${oldId} -> ${newId} "${title}" (used in ${postIds.size} posts)`);
      fixable++;
    } else {
      console.log(`  ❌ ${oldId} -> ??? "${title}" (used in ${postIds.size} posts) - NO MAPPING FOUND`);
      unfixable++;
    }
  }

  console.log(`\n📊 Fixable: ${fixable}, Unfixable: ${unfixable}\n`);

  if (unfixable > 0) {
    console.log('Unfixable blocks may need to be manually imported or recreated.\n');
  }

  // Step 6: Update posts with correct references
  if (fixable > 0) {
    console.log('Updating post content with correct block references...\n');

    let updated = 0;
    let errors = 0;

    for (const post of postsWithBlocks) {
      let newContent = post.post_content;
      let hasChanges = false;

      for (const [oldId, newId] of idMapping) {
        if (oldId !== newId && newContent.includes(`"ref":${oldId}`)) {
          newContent = newContent.replace(
            new RegExp(`"ref":${oldId}`, 'g'),
            `"ref":${newId}`
          );
          hasChanges = true;
        }
      }

      if (hasChanges) {
        if (dryRun) {
          console.log(`[DRY RUN] Would update post #${post.ID}: ${post.post_title}`);
          updated++;
        } else {
          try {
            await connection.execute(
              'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
              [newContent, post.ID]
            );
            console.log(`✓ Updated post #${post.ID}: ${post.post_title}`);
            updated++;
          } catch (e: any) {
            console.error(`✗ Error updating post #${post.ID}:`, e.message);
            errors++;
          }
        }
      }
    }

    console.log(`\n📊 Posts updated: ${updated}, Errors: ${errors}`);
  }

  await connection.end();
  console.log('\n✅ Done!');
}

main().catch(console.error);
