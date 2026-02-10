#!/usr/bin/env bun

/**
 * Import Reusable Blocks Script
 *
 * Extracts wp_block posts from old-db.sql and imports them into the local WordPress database
 *
 * Usage:
 *   bun scripts/import-reusable-blocks.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getConnection } from '../lib/db';

async function main() {
  console.log('🔍 Reading old-db.sql file...');

  const sqlPath = join(__dirname, 'old-db.sql');
  const sqlContent = readFileSync(sqlPath, 'utf-8');

  // Find the INSERT statement for posts and extract wp_block entries
  // The format is: (ID, post_author, post_date, ..., 'wp_block', ...)

  // We need to find complete tuples that contain 'wp_block'
  // Each tuple starts with ( and ends with ), and can span multiple lines

  console.log('📦 Extracting reusable blocks...');

  // Find all occurrences of tuples containing wp_block
  const tupleRegex = /\((\d+),\s*(\d+),\s*'([^']*)',\s*'([^']*)',\s*'((?:[^'\\]|\\.|'')*)',\s*'((?:[^'\\]|\\.|'')*)',\s*'((?:[^'\\]|\\.|'')*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*'([^']*)',\s*(\d+),\s*'wp_block',\s*'([^']*)',\s*(\d+)\)/g;

  const blocks: any[] = [];
  let match;

  // Simpler approach: find lines with wp_block and work backwards to get the full tuple
  const lines = sqlContent.split('\n');
  let currentTuple = '';
  let inTuple = false;
  let parenCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes("'wp_block'")) {
      // Found a wp_block line - need to find the start of this tuple
      // Go backwards to find the opening paren
      let tupleLines = [line];
      let j = i - 1;
      let openParens = (line.match(/\(/g) || []).length;
      let closeParens = (line.match(/\)/g) || []).length;

      while (j >= 0 && openParens <= closeParens) {
        const prevLine = lines[j];
        tupleLines.unshift(prevLine);
        openParens += (prevLine.match(/\(/g) || []).length;
        closeParens += (prevLine.match(/\)/g) || []).length;
        j--;
      }

      const fullTuple = tupleLines.join('\n');

      // Extract the tuple using a simpler regex - find from first ( to matching )
      const tupleMatch = fullTuple.match(/\((\d+),[\s\S]*?'wp_block',\s*'[^']*',\s*\d+\)/);
      if (tupleMatch) {
        blocks.push(tupleMatch[0]);
      }
    }
  }

  console.log(`📦 Found ${blocks.length} reusable blocks to import`);

  if (blocks.length === 0) {
    console.log('No reusable blocks found.');
    return;
  }

  // Connect to local MySQL
  console.log('🔌 Connecting to local MySQL...');

  const connection = await getConnection();

  console.log('✅ Connected to local database');

  // Check existing reusable blocks
  const [existingBlocks] = await connection.execute(
    "SELECT ID FROM wp_posts WHERE post_type = 'wp_block'"
  ) as [any[], any];

  console.log(`📋 Found ${existingBlocks.length} existing reusable blocks in local DB`);

  const existingIds = new Set(existingBlocks.map((b: any) => b.ID));

  // Import blocks one by one
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const tuple of blocks) {
    try {
      // Extract ID from tuple
      const idMatch = tuple.match(/^\((\d+)/);
      if (!idMatch) continue;

      const id = parseInt(idMatch[1]);

      if (existingIds.has(id)) {
        skipped++;
        continue;
      }

      // Clean the tuple
      let cleanTuple = tuple.trim();
      if (cleanTuple.endsWith(',')) {
        cleanTuple = cleanTuple.slice(0, -1);
      }

      const insertSQL = `
        INSERT INTO wp_posts (ID, post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged, post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type, comment_count)
        VALUES ${cleanTuple}
      `;

      await connection.execute(insertSQL);
      imported++;
      existingIds.add(id);

      if (imported % 50 === 0) {
        console.log(`   Imported ${imported} blocks...`);
      }

    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        skipped++;
      } else {
        errors++;
        if (errors <= 5) {
          console.error(`Error: ${err.message.substring(0, 100)}...`);
        }
      }
    }
  }

  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Imported: ${imported}`);
  console.log(`   ⏭️  Skipped (existing): ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);

  // Verify final count
  const [finalCount] = await connection.execute(
    "SELECT COUNT(*) as count FROM wp_posts WHERE post_type = 'wp_block'"
  ) as [any[], any];

  console.log(`\n📦 Total reusable blocks in local DB: ${finalCount[0].count}`);

  await connection.end();
  console.log('\n✅ Done!');
}

main().catch(console.error);
