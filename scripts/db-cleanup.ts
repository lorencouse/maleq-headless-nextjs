#!/usr/bin/env bun

/**
 * Database Cleanup Script
 *
 * Removes old plugin fragments, orphaned data, and stale caches from the WordPress database.
 *
 * Usage:
 *   bun scripts/db-cleanup.ts              # Dry run (default)
 *   bun scripts/db-cleanup.ts --execute    # Apply changes
 */

import { getConnection } from './lib/db';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const DIVIDER = '='.repeat(60);

interface CleanupResult {
  category: string;
  description: string;
  count: number;
  details?: string;
}

async function count(db: Connection, sql: string, params?: any[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows[0]?.cnt ?? 0;
}

async function exec(db: Connection, sql: string, params?: any[]): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result.affectedRows;
}

// ─── 1. Trashed posts + their postmeta ──────────────────────────────────────

async function cleanTrashedPosts(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_posts WHERE post_status = 'trash'`);

  if (!dryRun && cnt > 0) {
    // Delete postmeta for trashed posts first
    await exec(db, `
      DELETE pm FROM wp_postmeta pm
      INNER JOIN wp_posts p ON pm.post_id = p.ID
      WHERE p.post_status = 'trash'
    `);
    // Delete term_relationships for trashed posts
    await exec(db, `
      DELETE tr FROM wp_term_relationships tr
      INNER JOIN wp_posts p ON tr.object_id = p.ID
      WHERE p.post_status = 'trash'
    `);
    // Delete the trashed posts themselves
    await exec(db, `DELETE FROM wp_posts WHERE post_status = 'trash'`);
  }

  return { category: 'Trashed posts', description: 'Posts in trash + their meta/term relationships', count: cnt };
}

// ─── 2. Auto-drafts ─────────────────────────────────────────────────────────

async function cleanAutoDrafts(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_posts WHERE post_status = 'auto-draft'`);

  if (!dryRun && cnt > 0) {
    await exec(db, `
      DELETE pm FROM wp_postmeta pm
      INNER JOIN wp_posts p ON pm.post_id = p.ID
      WHERE p.post_status = 'auto-draft'
    `);
    await exec(db, `DELETE FROM wp_posts WHERE post_status = 'auto-draft'`);
  }

  return { category: 'Auto-drafts', description: 'Unfinished draft posts', count: cnt };
}

// ─── 3. Post revisions ──────────────────────────────────────────────────────

async function cleanRevisions(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_posts WHERE post_type = 'revision'`);

  if (!dryRun && cnt > 0) {
    await exec(db, `
      DELETE pm FROM wp_postmeta pm
      INNER JOIN wp_posts p ON pm.post_id = p.ID
      WHERE p.post_type = 'revision'
    `);
    await exec(db, `DELETE FROM wp_posts WHERE post_type = 'revision'`);
  }

  return { category: 'Revisions', description: 'Post revision history', count: cnt };
}

// ─── 4. Orphaned reusable blocks (wp_block not referenced by any post) ──────

async function cleanOrphanedBlocks(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  // Find wp_blocks that are NOT referenced in any published post's content
  const [orphans] = await db.execute<RowDataPacket[]>(`
    SELECT b.ID, b.post_title
    FROM wp_posts b
    WHERE b.post_type = 'wp_block'
    AND b.post_status = 'publish'
    AND NOT EXISTS (
      SELECT 1 FROM wp_posts p
      WHERE p.post_type = 'post'
      AND p.post_status = 'publish'
      AND p.post_content LIKE CONCAT('%wp:block {"ref":', b.ID, '}%')
    )
  `);

  const cnt = orphans.length;

  if (!dryRun && cnt > 0) {
    const ids = orphans.map((r: any) => r.ID);
    const placeholders = ids.map(() => '?').join(',');

    await exec(db, `DELETE FROM wp_postmeta WHERE post_id IN (${placeholders})`, ids);
    await exec(db, `DELETE FROM wp_term_relationships WHERE object_id IN (${placeholders})`, ids);
    await exec(db, `DELETE FROM wp_posts WHERE ID IN (${placeholders})`, ids);
  }

  return {
    category: 'Orphaned wp_blocks',
    description: 'Reusable blocks not referenced in any published post',
    count: cnt,
    details: `Includes AMP templates, duplicate Mr Q/Miss Q blocks, untitled blocks`,
  };
}

// ─── 5. BuddyPress navigation post ──────────────────────────────────────────

async function cleanBuddyPressNav(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_posts
    WHERE post_type = 'wp_navigation'
    AND post_title LIKE '%Buddy%'
  `);

  if (!dryRun && cnt > 0) {
    const [rows] = await db.execute<RowDataPacket[]>(`
      SELECT ID FROM wp_posts WHERE post_type = 'wp_navigation' AND post_title LIKE '%Buddy%'
    `);
    const ids = rows.map((r: any) => r.ID);
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      await exec(db, `DELETE FROM wp_postmeta WHERE post_id IN (${ph})`, ids);
      await exec(db, `DELETE FROM wp_posts WHERE ID IN (${ph})`, ids);
    }
  }

  return { category: 'BuddyPress navigation', description: '"Buddy Pannel Logged In" nav post', count: cnt };
}

// ─── 6. Old WP templates with cart/checkout refs ─────────────────────────────

async function cleanOldTemplates(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  // Templates 439815 and 439816 contain old cart/checkout/store links
  const cnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_posts
    WHERE ID IN (439815, 439816)
    AND post_type = 'wp_template'
  `);

  if (!dryRun && cnt > 0) {
    await exec(db, `DELETE FROM wp_postmeta WHERE post_id IN (439815, 439816)`);
    await exec(db, `DELETE FROM wp_posts WHERE ID IN (439815, 439816)`);
  }

  return { category: 'Old WP templates', description: 'Templates with dead cart/checkout links (IDs 439815, 439816)', count: cnt };
}

// ─── 7. Expired transients ───────────────────────────────────────────────────

async function cleanTransients(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_options WHERE option_name LIKE '_transient_%'`);

  if (!dryRun && cnt > 0) {
    // Delete expired transient timeouts and their values
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE '_transient_timeout_%'`);
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE '_transient_%'`);
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE '_site_transient_timeout_%'`);
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE '_site_transient_%'`);
  }

  return { category: 'Transients', description: 'Expired/stale transient caches in wp_options', count: cnt };
}

// ─── 8. Oembed postmeta ─────────────────────────────────────────────────────

async function cleanOembedMeta(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_postmeta WHERE meta_key LIKE '_oembed_%'`);

  if (!dryRun && cnt > 0) {
    await exec(db, `DELETE FROM wp_postmeta WHERE meta_key LIKE '_oembed_%'`);
  }

  return { category: 'Oembed meta', description: 'Old embed cache entries in postmeta', count: cnt };
}

// ─── 9. Jetpack options ──────────────────────────────────────────────────────

async function cleanJetpackOptions(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_options
    WHERE option_name LIKE 'jetpack%'
    OR option_name LIKE '%jetpack%'
  `);

  if (!dryRun && cnt > 0) {
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE 'jetpack%' OR option_name LIKE '%jetpack%'`);
  }

  return { category: 'Jetpack options', description: 'Leftover Jetpack sync/connection settings', count: cnt };
}

// ─── 10. Google Listings & Ads tables ────────────────────────────────────────

async function cleanGlaTables(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const [tables] = await db.execute<RowDataPacket[]>(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = 'local' AND TABLE_NAME LIKE 'wp_gla_%'
  `);
  const cnt = tables.length;

  if (!dryRun && cnt > 0) {
    for (const row of tables) {
      await db.execute(`DROP TABLE IF EXISTS \`${row.TABLE_NAME}\``);
    }
    await exec(db, `DELETE FROM wp_options WHERE option_name LIKE 'gla_%'`);
  }

  return {
    category: 'Google Listings & Ads',
    description: 'Empty wp_gla_* tables and options',
    count: cnt,
    details: tables.map((r: any) => r.TABLE_NAME).join(', '),
  };
}

// ─── 11. Jetpack sync queue table ────────────────────────────────────────────

async function cleanJetpackTable(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const [tables] = await db.execute<RowDataPacket[]>(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = 'local' AND TABLE_NAME = 'wp_jetpack_sync_queue'
  `);
  const cnt = tables.length;

  if (!dryRun && cnt > 0) {
    await db.execute(`DROP TABLE IF EXISTS wp_jetpack_sync_queue`);
  }

  return { category: 'Jetpack sync table', description: 'Empty wp_jetpack_sync_queue table', count: cnt };
}

// ─── 12. Action Scheduler cleanup ────────────────────────────────────────────

async function cleanActionScheduler(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  // Only clean completed/canceled actions and their logs — keep pending ones
  const actionCnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_actionscheduler_actions
    WHERE status IN ('complete', 'canceled', 'failed')
  `);
  const logCnt = await count(db, `SELECT COUNT(*) as cnt FROM wp_actionscheduler_logs`);

  if (!dryRun) {
    if (logCnt > 0) {
      // Delete logs for completed actions
      await exec(db, `
        DELETE l FROM wp_actionscheduler_logs l
        INNER JOIN wp_actionscheduler_actions a ON l.action_id = a.action_id
        WHERE a.status IN ('complete', 'canceled', 'failed')
      `);
    }
    if (actionCnt > 0) {
      await exec(db, `DELETE FROM wp_actionscheduler_actions WHERE status IN ('complete', 'canceled', 'failed')`);
    }
    // Clean orphan logs (action deleted but log remains)
    await exec(db, `
      DELETE l FROM wp_actionscheduler_logs l
      LEFT JOIN wp_actionscheduler_actions a ON l.action_id = a.action_id
      WHERE a.action_id IS NULL
    `);
  }

  return {
    category: 'Action Scheduler',
    description: 'Completed/canceled/failed actions and their logs',
    count: actionCnt,
    details: `${actionCnt} actions + ${logCnt} log entries`,
  };
}

// ─── 13. Orphaned postmeta (meta for posts that no longer exist) ─────────────

async function cleanOrphanedPostmeta(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_postmeta pm
    LEFT JOIN wp_posts p ON pm.post_id = p.ID
    WHERE p.ID IS NULL
  `);

  if (!dryRun && cnt > 0) {
    await exec(db, `
      DELETE pm FROM wp_postmeta pm
      LEFT JOIN wp_posts p ON pm.post_id = p.ID
      WHERE p.ID IS NULL
    `);
  }

  return { category: 'Orphaned postmeta', description: 'Meta entries for non-existent posts', count: cnt };
}

// ─── 14. Orphaned term relationships ─────────────────────────────────────────

async function cleanOrphanedTermRelationships(db: Connection, dryRun: boolean): Promise<CleanupResult> {
  const cnt = await count(db, `
    SELECT COUNT(*) as cnt FROM wp_term_relationships tr
    LEFT JOIN wp_posts p ON tr.object_id = p.ID
    WHERE p.ID IS NULL
  `);

  if (!dryRun && cnt > 0) {
    await exec(db, `
      DELETE tr FROM wp_term_relationships tr
      LEFT JOIN wp_posts p ON tr.object_id = p.ID
      WHERE p.ID IS NULL
    `);
  }

  return { category: 'Orphaned term_relationships', description: 'Taxonomy links for non-existent posts', count: cnt };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log(`\n${DIVIDER}`);
  console.log('  DATABASE CLEANUP');
  console.log(DIVIDER);

  if (dryRun) {
    console.log('  Mode: DRY RUN (no changes will be made)');
    console.log('  Use --execute to apply changes\n');
  } else {
    console.log('  Mode: EXECUTE (changes will be applied)\n');
  }

  const db = await getConnection();
  console.log('  Connected to database\n');

  try {
    const results: CleanupResult[] = [];

    const steps = [
      { name: 'Trashed posts', fn: cleanTrashedPosts },
      { name: 'Auto-drafts', fn: cleanAutoDrafts },
      { name: 'Revisions', fn: cleanRevisions },
      { name: 'Orphaned wp_blocks', fn: cleanOrphanedBlocks },
      { name: 'BuddyPress nav', fn: cleanBuddyPressNav },
      { name: 'Old WP templates', fn: cleanOldTemplates },
      { name: 'Transients', fn: cleanTransients },
      { name: 'Oembed meta', fn: cleanOembedMeta },
      { name: 'Jetpack options', fn: cleanJetpackOptions },
      { name: 'Google Listings tables', fn: cleanGlaTables },
      { name: 'Jetpack sync table', fn: cleanJetpackTable },
      { name: 'Action Scheduler', fn: cleanActionScheduler },
      { name: 'Orphaned postmeta', fn: cleanOrphanedPostmeta },
      { name: 'Orphaned term_relationships', fn: cleanOrphanedTermRelationships },
    ];

    for (const step of steps) {
      process.stdout.write(`  ${dryRun ? 'Counting' : 'Cleaning'}: ${step.name}...`);
      const result = await step.fn(db, dryRun);
      results.push(result);
      console.log(` ${result.count > 0 ? result.count.toLocaleString() : '0'}`);
    }

    // Summary
    console.log(`\n${DIVIDER}`);
    console.log('  SUMMARY');
    console.log(DIVIDER);
    console.log('');

    let totalItems = 0;
    const pad = (s: string, n: number) => s.padEnd(n);

    console.log(`  ${pad('Category', 30)} ${pad('Count', 10)} Description`);
    console.log(`  ${'-'.repeat(30)} ${'-'.repeat(10)} ${'-'.repeat(40)}`);

    for (const r of results) {
      const countStr = r.count > 0 ? r.count.toLocaleString() : '-';
      console.log(`  ${pad(r.category, 30)} ${pad(countStr, 10)} ${r.description}`);
      if (r.details) {
        console.log(`  ${' '.repeat(30)} ${' '.repeat(10)} -> ${r.details}`);
      }
      totalItems += r.count;
    }

    console.log(`\n  Total items: ${totalItems.toLocaleString()}`);

    if (dryRun) {
      console.log(`\n  Run with --execute to apply these changes.`);
      console.log(`  Make sure you have a recent DB backup!\n`);
    } else {
      // Optimize tables after cleanup
      console.log('\n  Optimizing tables...');
      for (const table of ['wp_posts', 'wp_postmeta', 'wp_options', 'wp_term_relationships']) {
        await db.execute(`OPTIMIZE TABLE ${table}`);
      }
      console.log('  Done.\n');
    }
  } finally {
    await db.end();
    console.log('  Database connection closed.\n');
  }
}

main().catch(console.error);
