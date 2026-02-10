#!/usr/bin/env bun

/**
 * Restore specific posts from SQL backup
 * Only restores post_content for specified IDs, preserving all other data
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { getConnection } from '../lib/db';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const BACKUP_FILE = args[0] || 'backups/local-wp-backup-20260126.sql';

// IDs of posts that were affected by the cleanup script
const AFFECTED_IDS = new Set([
  131,134,148,159,160,161,162,164,165,166,167,168,169,170,171,173,176,178,179,184,
  186,187,189,197,206,209,211,224,227,231,233,241,242,244,246,247,248,249,251,253,
  254,255,256,257,258,259,260,261,262,264,265,267,273,274,276,279,281,282,283,284,
  285,286,287,288,289,291,292,293,294,295,296,
  // Reusable blocks
  382226,382276,382813,382815,382817,382819,382821,382823,382826,382828,382834,
  383052,383057,383141,384072,384165,384169,384177,384279,386016,386017,386213,
  433832,433907,433910,433968,434134,435242,435433,435480,435498,435519,435537,
  435639,435687,435702,437054,437055,437057,437062,437064,437068,437070,437071,
  437090,437095,437100,437101,437102,437104,437112,437118,437121,437122,437126,
  437130,437131,437149,437150,437156,437161,437162,437163,437164,437186,437189,
  437193,437236,437244,437264,437265,437267,437272,437274,437275,437276,437277,
  437278,437279,437280,437281,437319,437326,437327,437336,437362,437439,437440,
  437441,437579,437581,437625,437627,437632,437633,437876,437877,438068,438069,
  439936,439941,440127,440128,440129,440130,440131,440132,440133,440153,440304,
  440370,440390,440999,441581,441582,442131,442132,442133,442134,442171,442226,
  442232,435670,437337,437340,437341,440651
]);

interface PostData {
  id: number;
  content: string;
}

async function extractPostsFromBackup(backupPath: string): Promise<Map<number, string>> {
  console.log(`Reading backup file: ${backupPath}`);

  const posts = new Map<number, string>();

  const fileStream = createReadStream(backupPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inPostsInsert = false;
  let buffer = '';

  for await (const line of rl) {
    // Look for wp_posts INSERT statements
    if (line.startsWith('INSERT INTO `wp_posts`')) {
      inPostsInsert = true;
      buffer = line;
    } else if (inPostsInsert) {
      buffer += line;

      // Check if the statement is complete
      if (line.endsWith(';')) {
        // Parse the INSERT statement
        parseInsertStatement(buffer, posts);
        inPostsInsert = false;
        buffer = '';
      }
    }
  }

  return posts;
}

function parseInsertStatement(sql: string, posts: Map<number, string>): void {
  // Match VALUES clause
  const valuesMatch = sql.match(/VALUES\s*(.+);$/s);
  if (!valuesMatch) return;

  const valuesStr = valuesMatch[1];

  // Split into individual value tuples - this is tricky due to nested parentheses and quotes
  // We'll use a simple state machine
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

  // Parse each tuple
  for (const tuple of tuples) {
    try {
      // Extract ID (first field) and post_content (5th field - index 4)
      const fields = parseTupleFields(tuple);
      if (fields.length > 4) {
        const id = parseInt(fields[0], 10);
        if (AFFECTED_IDS.has(id)) {
          // Field 4 is post_content (0-indexed)
          const content = unescapeSqlString(fields[4]);
          posts.set(id, content);
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
      continue; // Don't include the quotes
    }

    if (char === ',' && !inString) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function unescapeSqlString(s: string): string {
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

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Restore Posts from Backup                 ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (dryRun) {
    console.log('Mode: DRY RUN\n');
  }

  // Extract posts from backup
  const posts = await extractPostsFromBackup(BACKUP_FILE);
  console.log(`\nFound ${posts.size} affected posts in backup\n`);

  if (posts.size === 0) {
    console.log('No posts found to restore.');
    return;
  }

  // Connect to database
  const connection = await getConnection();

  console.log('✓ Connected to MySQL\n');

  let restored = 0;
  let errors = 0;

  for (const [id, content] of posts) {
    try {
      if (dryRun) {
        console.log(`[DRY RUN] Would restore post #${id} (${content.length} chars)`);
      } else {
        await connection.execute(
          'UPDATE wp_posts SET post_content = ? WHERE ID = ?',
          [content, id]
        );
        console.log(`✓ Restored post #${id}`);
      }
      restored++;
    } catch (e) {
      console.error(`✗ Error restoring post #${id}:`, e);
      errors++;
    }
  }

  await connection.end();

  console.log('\n=== SUMMARY ===');
  console.log(`Posts restored: ${restored}`);
  console.log(`Errors: ${errors}`);
  console.log(`Posts not found in backup: ${AFFECTED_IDS.size - posts.size}`);
}

main().catch(console.error);
