#!/usr/bin/env bun

/**
 * Restore Reusable Blocks from SQL Backup
 *
 * Extracts wp_block posts from old-db.sql and imports them into the local WordPress database
 * Uses robust SQL parsing to handle complex post_content values
 *
 * Usage:
 *   bun scripts/restore-reusable-blocks.ts [--dry-run]
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { getConnection } from '../lib/db';

const BACKUP_FILE = 'scripts/old-db.sql';

interface BlockData {
  ID: number;
  post_author: number;
  post_date: string;
  post_date_gmt: string;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_status: string;
  comment_status: string;
  ping_status: string;
  post_password: string;
  post_name: string;
  to_ping: string;
  pinged: string;
  post_modified: string;
  post_modified_gmt: string;
  post_content_filtered: string;
  post_parent: number;
  guid: string;
  menu_order: number;
  post_type: string;
  post_mime_type: string;
  comment_count: number;
}

async function extractBlocksFromBackup(backupPath: string): Promise<Map<number, BlockData>> {
  console.log(`📂 Reading backup file: ${backupPath}`);

  const blocks = new Map<number, BlockData>();

  const fileStream = createReadStream(backupPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inPostsInsert = false;
  let buffer = '';

  for await (const line of rl) {
    // Look for posts INSERT statements (handles different prefixes: wp_, p1bJcx_, etc.)
    if (line.match(/^INSERT INTO `[^`]*_posts`/)) {
      inPostsInsert = true;
      buffer = line;
    } else if (inPostsInsert) {
      buffer += '\n' + line;

      // Check if the statement is complete
      if (line.endsWith(';')) {
        // Parse the INSERT statement
        parseInsertStatement(buffer, blocks);
        inPostsInsert = false;
        buffer = '';
      }
    }
  }

  return blocks;
}

function parseInsertStatement(sql: string, blocks: Map<number, BlockData>): void {
  // Match VALUES clause
  const valuesMatch = sql.match(/VALUES\s*(.+);$/s);
  if (!valuesMatch) return;

  const valuesStr = valuesMatch[1];

  // Split into individual value tuples using state machine
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
        if (depth === 0) {
          current = '';
        } else {
          current += char;
        }
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

  // Parse each tuple and extract wp_block posts
  for (const tuple of tuples) {
    try {
      const fields = parseTupleFields(tuple);
      // wp_posts has 23 fields:
      // 0:ID, 1:post_author, 2:post_date, 3:post_date_gmt, 4:post_content, 5:post_title,
      // 6:post_excerpt, 7:post_status, 8:comment_status, 9:ping_status, 10:post_password,
      // 11:post_name, 12:to_ping, 13:pinged, 14:post_modified, 15:post_modified_gmt,
      // 16:post_content_filtered, 17:post_parent, 18:guid, 19:menu_order, 20:post_type,
      // 21:post_mime_type, 22:comment_count

      if (fields.length >= 23) {
        const postType = unescapeSqlString(fields[20]);

        // Capture all WordPress editor-related post types
        const editorPostTypes = ['wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'];
        if (editorPostTypes.includes(postType)) {
          const id = parseInt(fields[0], 10);
          const block: BlockData = {
            ID: id,
            post_author: parseInt(fields[1], 10),
            post_date: unescapeSqlString(fields[2]),
            post_date_gmt: unescapeSqlString(fields[3]),
            post_content: unescapeSqlString(fields[4]),
            post_title: unescapeSqlString(fields[5]),
            post_excerpt: unescapeSqlString(fields[6]),
            post_status: unescapeSqlString(fields[7]),
            comment_status: unescapeSqlString(fields[8]),
            ping_status: unescapeSqlString(fields[9]),
            post_password: unescapeSqlString(fields[10]),
            post_name: unescapeSqlString(fields[11]),
            to_ping: unescapeSqlString(fields[12]),
            pinged: unescapeSqlString(fields[13]),
            post_modified: unescapeSqlString(fields[14]),
            post_modified_gmt: unescapeSqlString(fields[15]),
            post_content_filtered: unescapeSqlString(fields[16]),
            post_parent: parseInt(fields[17], 10),
            guid: unescapeSqlString(fields[18]),
            menu_order: parseInt(fields[19], 10),
            post_type: postType,
            post_mime_type: unescapeSqlString(fields[21]),
            comment_count: parseInt(fields[22], 10),
          };
          blocks.set(id, block);
        }
      }
    } catch (e) {
      // Skip malformed tuples
    }
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
      if (!inString) {
        inString = true;
      } else {
        inString = false;
      }
      continue; // Don't include the quotes
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
  console.log('║  Restore Reusable Blocks & Patterns from Backup   ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    console.log('Mode: DRY RUN\n');
  }

  // Extract blocks from backup
  const blocks = await extractBlocksFromBackup(BACKUP_FILE);
  console.log(`\n📦 Found ${blocks.size} editor components in backup\n`);

  if (blocks.size === 0) {
    console.log('No editor components found in backup.');
    return;
  }

  // Count by type
  const byType: Record<string, number> = {};
  for (const [_, block] of blocks) {
    byType[block.post_type] = (byType[block.post_type] || 0) + 1;
  }
  console.log('By type:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  - ${type}: ${count}`);
  }
  console.log('');

  // Connect to database
  const connection = await getConnection();

  console.log('✓ Connected to MySQL\n');

  // Get existing blocks
  const [existingBlocks] = await connection.execute(
    "SELECT ID, post_title, post_type FROM wp_posts WHERE post_type IN ('wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles')"
  ) as [any[], any];

  console.log(`📋 Found ${existingBlocks.length} existing editor components in local DB\n`);

  const existingBlockIds = new Set(existingBlocks.map((b: any) => b.ID));

  // Also get ALL existing post IDs (for any post type)
  const [allPosts] = await connection.execute(
    "SELECT ID FROM wp_posts"
  ) as [any[], any];
  const allExistingIds = new Set(allPosts.map((p: any) => p.ID));

  // Get max ID for generating new IDs
  const [maxIdResult] = await connection.execute(
    "SELECT MAX(ID) as maxId FROM wp_posts"
  ) as [any[], any];
  let nextId = (maxIdResult[0].maxId || 0) + 1;

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let reassigned = 0;

  for (const [id, block] of blocks) {
    try {
      if (existingBlockIds.has(id)) {
        // Update existing block (same ID, same post_type)
        if (dryRun) {
          console.log(`[DRY RUN] Would update block #${id}: ${block.post_title}`);
        } else {
          await connection.execute(
            `UPDATE wp_posts SET
              post_content = ?,
              post_title = ?,
              post_excerpt = ?,
              post_status = ?,
              post_name = ?,
              post_modified = ?,
              post_modified_gmt = ?
            WHERE ID = ?`,
            [
              block.post_content,
              block.post_title,
              block.post_excerpt,
              block.post_status,
              block.post_name,
              block.post_modified,
              block.post_modified_gmt,
              id
            ]
          );
        }
        updated++;
      } else if (allExistingIds.has(id)) {
        // ID exists for a different post type - assign new ID
        const newId = nextId++;
        if (dryRun) {
          console.log(`[DRY RUN] Would import block "${block.post_title}" with new ID #${newId} (original: ${id})`);
        } else {
          await connection.execute(
            `INSERT INTO wp_posts (
              ID, post_author, post_date, post_date_gmt, post_content, post_title,
              post_excerpt, post_status, comment_status, ping_status, post_password,
              post_name, to_ping, pinged, post_modified, post_modified_gmt,
              post_content_filtered, post_parent, guid, menu_order, post_type,
              post_mime_type, comment_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newId,
              block.post_author,
              block.post_date,
              block.post_date_gmt,
              block.post_content,
              block.post_title,
              block.post_excerpt,
              block.post_status,
              block.comment_status,
              block.ping_status,
              block.post_password,
              block.post_name,
              block.to_ping,
              block.pinged,
              block.post_modified,
              block.post_modified_gmt,
              block.post_content_filtered,
              block.post_parent,
              block.guid.replace(String(id), String(newId)),
              block.menu_order,
              block.post_type,
              block.post_mime_type,
              block.comment_count
            ]
          );
          console.log(`   📦 Imported "${block.post_title}" with new ID #${newId}`);
        }
        reassigned++;
        imported++;
      } else {
        // Insert new block with original ID
        if (dryRun) {
          console.log(`[DRY RUN] Would import block #${id}: ${block.post_title}`);
        } else {
          await connection.execute(
            `INSERT INTO wp_posts (
              ID, post_author, post_date, post_date_gmt, post_content, post_title,
              post_excerpt, post_status, comment_status, ping_status, post_password,
              post_name, to_ping, pinged, post_modified, post_modified_gmt,
              post_content_filtered, post_parent, guid, menu_order, post_type,
              post_mime_type, comment_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              block.ID,
              block.post_author,
              block.post_date,
              block.post_date_gmt,
              block.post_content,
              block.post_title,
              block.post_excerpt,
              block.post_status,
              block.comment_status,
              block.ping_status,
              block.post_password,
              block.post_name,
              block.to_ping,
              block.pinged,
              block.post_modified,
              block.post_modified_gmt,
              block.post_content_filtered,
              block.post_parent,
              block.guid,
              block.menu_order,
              block.post_type,
              block.post_mime_type,
              block.comment_count
            ]
          );
        }
        imported++;
      }

      if ((imported + updated) % 50 === 0) {
        console.log(`   Progress: ${imported} imported, ${updated} updated...`);
      }

    } catch (e: any) {
      errors++;
      if (errors <= 5) {
        console.error(`✗ Error with block #${id} (${block.post_title}):`, e.message?.substring(0, 100));
      }
    }
  }

  await connection.end();

  // Final count
  const connection2 = await getConnection();

  const [finalCount] = await connection2.execute(
    "SELECT COUNT(*) as count FROM wp_posts WHERE post_type IN ('wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles')"
  ) as [any[], any];

  await connection2.end();

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                         ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Imported: ${String(imported).padEnd(34)}║`);
  console.log(`║     (with new IDs: ${String(reassigned).padEnd(29)}║`);
  console.log(`║  🔄 Updated: ${String(updated).padEnd(35)}║`);
  console.log(`║  ❌ Errors: ${String(errors).padEnd(36)}║`);
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  📦 Total editor components in local DB: ${String(finalCount[0].count).padEnd(7)}║`);
  console.log('╚════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);
