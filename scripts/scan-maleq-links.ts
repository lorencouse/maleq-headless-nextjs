/**
 * Scan the entire WordPress database for any references to maleq.com
 * Usage: bun run scripts/scan-maleq-links.ts
 */
import { getConnection } from './lib/db';

interface Match {
  table: string;
  column: string;
  id: number | string;
  identifier: string;
  snippet: string;
}

async function main() {
  const db = await getConnection();
  const matches: Match[] = [];
  const pattern = '%maleq.com%';

  console.log('Scanning WordPress database for maleq.com references...\n');

  // 1. wp_posts - content, excerpt, guid
  console.log('Scanning wp_posts...');
  const [postContent] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, post_status,
       SUBSTRING(post_content, GREATEST(1, LOCATE('maleq.com', post_content) - 50), 150) AS snippet
     FROM wp_posts WHERE post_content LIKE ?`, [pattern]
  );
  for (const row of postContent) {
    matches.push({
      table: 'wp_posts', column: 'post_content',
      id: row.ID, identifier: `[${row.post_type}/${row.post_status}] ${row.post_title}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  const [postExcerpt] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, post_status,
       SUBSTRING(post_excerpt, GREATEST(1, LOCATE('maleq.com', post_excerpt) - 50), 150) AS snippet
     FROM wp_posts WHERE post_excerpt LIKE ?`, [pattern]
  );
  for (const row of postExcerpt) {
    matches.push({
      table: 'wp_posts', column: 'post_excerpt',
      id: row.ID, identifier: `[${row.post_type}/${row.post_status}] ${row.post_title}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  const [postGuid] = await db.query<any[]>(
    `SELECT ID, post_title, post_type, guid FROM wp_posts WHERE guid LIKE ?`, [pattern]
  );
  for (const row of postGuid) {
    matches.push({
      table: 'wp_posts', column: 'guid',
      id: row.ID, identifier: `[${row.post_type}] ${row.post_title}`,
      snippet: row.guid
    });
  }

  // 2. wp_postmeta - meta_value
  console.log('Scanning wp_postmeta...');
  const [postMeta] = await db.query<any[]>(
    `SELECT pm.meta_id, pm.post_id, pm.meta_key,
       SUBSTRING(pm.meta_value, GREATEST(1, LOCATE('maleq.com', pm.meta_value) - 50), 150) AS snippet,
       p.post_title, p.post_type
     FROM wp_postmeta pm
     LEFT JOIN wp_posts p ON p.ID = pm.post_id
     WHERE pm.meta_value LIKE ?`, [pattern]
  );
  for (const row of postMeta) {
    matches.push({
      table: 'wp_postmeta', column: `meta_key: ${row.meta_key}`,
      id: row.post_id, identifier: `[${row.post_type}] ${row.post_title}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  // 3. wp_options
  console.log('Scanning wp_options...');
  const [options] = await db.query<any[]>(
    `SELECT option_id, option_name,
       SUBSTRING(option_value, GREATEST(1, LOCATE('maleq.com', option_value) - 50), 150) AS snippet
     FROM wp_options WHERE option_value LIKE ?`, [pattern]
  );
  for (const row of options) {
    matches.push({
      table: 'wp_options', column: 'option_value',
      id: row.option_id, identifier: row.option_name,
      snippet: row.snippet?.trim() || ''
    });
  }

  // 4. wp_comments
  console.log('Scanning wp_comments...');
  const [commentContent] = await db.query<any[]>(
    `SELECT comment_ID, comment_author,
       SUBSTRING(comment_content, GREATEST(1, LOCATE('maleq.com', comment_content) - 50), 150) AS snippet
     FROM wp_comments WHERE comment_content LIKE ?`, [pattern]
  );
  for (const row of commentContent) {
    matches.push({
      table: 'wp_comments', column: 'comment_content',
      id: row.comment_ID, identifier: `by ${row.comment_author}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  const [commentUrl] = await db.query<any[]>(
    `SELECT comment_ID, comment_author, comment_author_url
     FROM wp_comments WHERE comment_author_url LIKE ?`, [pattern]
  );
  for (const row of commentUrl) {
    matches.push({
      table: 'wp_comments', column: 'comment_author_url',
      id: row.comment_ID, identifier: `by ${row.comment_author}`,
      snippet: row.comment_author_url
    });
  }

  // 5. wp_termmeta
  console.log('Scanning wp_termmeta...');
  const [termMeta] = await db.query<any[]>(
    `SELECT tm.meta_id, tm.term_id, tm.meta_key,
       SUBSTRING(tm.meta_value, GREATEST(1, LOCATE('maleq.com', tm.meta_value) - 50), 150) AS snippet,
       t.name
     FROM wp_termmeta tm
     LEFT JOIN wp_terms t ON t.term_id = tm.term_id
     WHERE tm.meta_value LIKE ?`, [pattern]
  );
  for (const row of termMeta) {
    matches.push({
      table: 'wp_termmeta', column: `meta_key: ${row.meta_key}`,
      id: row.term_id, identifier: `term: ${row.name}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  // 6. wp_term_taxonomy - description
  console.log('Scanning wp_term_taxonomy...');
  const [termTax] = await db.query<any[]>(
    `SELECT tt.term_taxonomy_id, tt.term_id, tt.taxonomy,
       SUBSTRING(tt.description, GREATEST(1, LOCATE('maleq.com', tt.description) - 50), 150) AS snippet,
       t.name
     FROM wp_term_taxonomy tt
     LEFT JOIN wp_terms t ON t.term_id = tt.term_id
     WHERE tt.description LIKE ?`, [pattern]
  );
  for (const row of termTax) {
    matches.push({
      table: 'wp_term_taxonomy', column: 'description',
      id: row.term_id, identifier: `[${row.taxonomy}] ${row.name}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  // 7. wp_usermeta
  console.log('Scanning wp_usermeta...');
  const [userMeta] = await db.query<any[]>(
    `SELECT umeta_id, user_id, meta_key,
       SUBSTRING(meta_value, GREATEST(1, LOCATE('maleq.com', meta_value) - 50), 150) AS snippet
     FROM wp_usermeta WHERE meta_value LIKE ?`, [pattern]
  );
  for (const row of userMeta) {
    matches.push({
      table: 'wp_usermeta', column: `meta_key: ${row.meta_key}`,
      id: row.user_id, identifier: `user_id: ${row.user_id}`,
      snippet: row.snippet?.trim() || ''
    });
  }

  // 8. wp_links (if it exists)
  console.log('Scanning wp_links...');
  try {
    const [links] = await db.query<any[]>(
      `SELECT link_id, link_name, link_url FROM wp_links WHERE link_url LIKE ?`, [pattern]
    );
    for (const row of links) {
      matches.push({
        table: 'wp_links', column: 'link_url',
        id: row.link_id, identifier: row.link_name,
        snippet: row.link_url
      });
    }
  } catch { /* table may not exist */ }

  await db.end();

  // Print results
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SCAN COMPLETE: Found ${matches.length} references to maleq.com`);
  console.log(`${'='.repeat(80)}\n`);

  if (matches.length === 0) {
    console.log('No maleq.com references found in the database!');
    return;
  }

  // Group by table
  const grouped = new Map<string, Match[]>();
  for (const m of matches) {
    const key = m.table;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  for (const [table, items] of grouped) {
    console.log(`\n--- ${table} (${items.length} matches) ---`);
    for (const item of items) {
      console.log(`  ID: ${item.id} | ${item.column} | ${item.identifier}`);
      console.log(`    Snippet: ${item.snippet.replace(/\n/g, ' ').substring(0, 120)}`);
    }
  }

  // Summary by table
  console.log(`\n\n--- SUMMARY ---`);
  for (const [table, items] of grouped) {
    // Sub-group by column
    const colCounts = new Map<string, number>();
    for (const item of items) {
      colCounts.set(item.column, (colCounts.get(item.column) || 0) + 1);
    }
    const details = [...colCounts.entries()].map(([col, count]) => `${col}: ${count}`).join(', ');
    console.log(`  ${table}: ${items.length} total (${details})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
