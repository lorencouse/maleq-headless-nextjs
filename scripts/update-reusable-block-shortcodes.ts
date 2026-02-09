#!/usr/bin/env bun

/**
 * Update Reusable Block Shortcodes
 *
 * Applies approved shortcode mappings from shortcode-review.json to reusable blocks.
 *
 * Usage:
 *   bun scripts/update-reusable-block-shortcodes.ts --dry-run
 *   bun scripts/update-reusable-block-shortcodes.ts
 */

import { createConnection, Connection } from 'mysql2/promise';
import { readFileSync } from 'fs';

interface ShortcodeMapping {
  oldId: string;
  oldShortcode: string;
  newShortcode: string;
  decision: string;
}

interface ReusableBlock {
  id: number;
  title: string;
  content: string;
}

interface ProcessOptions {
  dryRun: boolean;
}

function parseArgs(): ProcessOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
  };
}

async function getConnection(): Promise<Connection> {
  return createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'local',
    socketPath: '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock',
  });
}

function loadMappings(): Map<string, string> {
  const data = JSON.parse(readFileSync('data/shortcode-review.json', 'utf-8'));
  const mappings = new Map<string, string>();

  for (const item of data.items) {
    if ((item.decision === 'approved' || item.decision === 'manual') && item.newShortcode && item.oldId) {
      // Map old ID to new shortcode
      mappings.set(item.oldId, item.newShortcode);
    }
  }

  return mappings;
}

async function getReusableBlocks(connection: Connection): Promise<ReusableBlock[]> {
  const [rows] = await connection.execute(`
    SELECT ID as id, post_title as title, post_content as content
    FROM wp_posts
    WHERE post_type = 'wp_block'
      AND post_status = 'publish'
      AND post_content LIKE '%[add_to_cart%'
  `);

  return rows as ReusableBlock[];
}

function extractShortcodeIds(content: string): string[] {
  const regex = /\[add_to_cart\s+id="(\d+)"\]/g;
  const ids: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }

  return ids;
}

function applyMappings(content: string, mappings: Map<string, string>): { newContent: string; changes: string[] } {
  const changes: string[] = [];
  let newContent = content;

  // Find all shortcodes with IDs
  const regex = /\[add_to_cart\s+id="(\d+)"\]/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const oldId = match[1];
    const oldShortcode = match[0];
    const newShortcode = mappings.get(oldId);

    if (newShortcode) {
      newContent = newContent.replace(oldShortcode, newShortcode);
      changes.push(`${oldShortcode} => ${newShortcode}`);
    }
  }

  return { newContent, changes };
}

async function updateBlock(connection: Connection, blockId: number, newContent: string): Promise<void> {
  await connection.execute(
    `UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = NOW() WHERE ID = ?`,
    [newContent, blockId]
  );
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('Update Reusable Block Shortcodes');
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Load mappings
  console.log('Loading shortcode mappings...');
  const mappings = loadMappings();
  console.log(`Loaded ${mappings.size} unique ID mappings\n`);

  const connection = await getConnection();

  try {
    // Get reusable blocks
    const blocks = await getReusableBlocks(connection);
    console.log(`Found ${blocks.length} reusable blocks with shortcodes\n`);

    let blocksUpdated = 0;
    let shortcodesUpdated = 0;
    let blocksWithNoMapping = 0;

    for (const block of blocks) {
      const { newContent, changes } = applyMappings(block.content, mappings);

      if (changes.length > 0) {
        console.log(`📦 ${block.title} (ID: ${block.id})`);
        for (const change of changes) {
          console.log(`   ${change}`);
        }

        if (!options.dryRun) {
          await updateBlock(connection, block.id, newContent);
        }

        blocksUpdated++;
        shortcodesUpdated += changes.length;
        console.log('');
      } else {
        // Check if there are shortcodes with no mapping
        const ids = extractShortcodeIds(block.content);
        if (ids.length > 0) {
          blocksWithNoMapping++;
        }
      }
    }

    console.log('='.repeat(60));
    console.log('Summary:');
    console.log(`  Blocks updated: ${blocksUpdated}`);
    console.log(`  Shortcodes updated: ${shortcodesUpdated}`);
    console.log(`  Blocks with unmapped shortcodes: ${blocksWithNoMapping}`);
    if (options.dryRun) {
      console.log('\n  (Dry run - no actual changes made)');
    }
    console.log('='.repeat(60));

    // List blocks with unmapped shortcodes
    if (blocksWithNoMapping > 0) {
      console.log('\nBlocks with unmapped shortcodes (need manual review):');
      for (const block of blocks) {
        const { changes } = applyMappings(block.content, mappings);
        if (changes.length === 0) {
          const ids = extractShortcodeIds(block.content);
          if (ids.length > 0) {
            console.log(`  - ${block.title} (ID: ${block.id}): IDs [${ids.join(', ')}]`);
          }
        }
      }
    }

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
