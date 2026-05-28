/**
 * Backfill the `_maleq_related_products` post-meta from products already
 * embedded in existing blog posts (WooCommerce shortcodes / rendered output).
 *
 * Populates the same ordered-CSV meta key that the `maleq-post-product-relations`
 * mu-plugin meta box writes, so the new "Recommended Products" / "Related Guides"
 * surfaces work for legacy posts without manual re-entry.
 *
 * Product references are extracted from raw post_content in these forms:
 *   - [add_to_cart id="123"]            (and id=123 / id='123')
 *   - [add_to_cart sku="813356..."]     (numeric or variation SKUs, e.g. VAR-...)
 *   - [product id="123"] / [product_page id="123"]
 *   - [products ids="12,34,56"]
 *   - data-product_id="123"             (already-rendered shortcode output)
 * SKUs are resolved to their post via _sku meta; variation IDs/SKUs are mapped
 * to their parent product. Order is first-seen.
 *
 * Reusable blocks / synced patterns: a post that embeds products via a reusable
 * block only stores `<!-- wp:block {"ref":N} /-->` in its post_content — the
 * shortcodes live in the wp_block post N. We expand those refs (recursively)
 * before extracting, mirroring what WordPress do_blocks() does at render time.
 *
 * Usage (DB target follows scripts/lib/db.ts — REMOTE/prod by default):
 *   bun run scripts/backfill-post-product-relations.ts                 # dry-run, remote
 *   bun run scripts/backfill-post-product-relations.ts --local         # dry-run, local
 *   bun run scripts/backfill-post-product-relations.ts --category sex-toys
 *   bun run scripts/backfill-post-product-relations.ts --local --write # persist to local
 *   bun run scripts/backfill-post-product-relations.ts --write --yes   # persist to PROD
 *
 * Flags:
 *   --write        Persist meta (default: dry-run, prints what would change)
 *   --yes          Required to actually write to the REMOTE/prod DB (safety)
 *   --overwrite    Replace existing _maleq_related_products (default: skip posts
 *                  that already have it, so manual curation is never clobbered)
 *   --category S   Restrict to posts in the blog category with slug S
 *   --limit N      Process at most N posts (for testing)
 */
import type { RowDataPacket } from 'mysql2';
import { getConnection } from './lib/db';

const PRODUCTS_META = '_maleq_related_products';

const argv = process.argv;
const WRITE = argv.includes('--write');
const YES = argv.includes('--yes');
const OVERWRITE = argv.includes('--overwrite');
const IS_LOCAL = argv.includes('--local') || process.env.MYSQL_LOCAL === '1';

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const CATEGORY = flagValue('--category');
const LIMIT = flagValue('--limit') ? parseInt(flagValue('--limit')!, 10) : undefined;

type Token = { type: 'id' | 'sku'; value: string };

/** Extract product references (id or sku) from raw content, first-seen order. */
function extractTokens(content: string): Token[] {
  if (!content) return [];
  const tokens: Token[] = [];
  const seen = new Set<string>();
  const add = (type: 'id' | 'sku', value: string) => {
    value = value.trim();
    const key = `${type}:${value}`;
    if (value && !seen.has(key)) {
      seen.add(key);
      tokens.push({ type, value });
    }
  };

  // Walk the product shortcodes in document order, reading id(s)/sku(s) from each.
  const scRe = /\[(add_to_cart|product_page|product|products)\b([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = scRe.exec(content)) !== null) {
    const attrs = m[2];
    const idMatch = /\bids?=["']?([\d,\s]+)["']?/i.exec(attrs);
    if (idMatch) for (const part of idMatch[1].split(',')) add('id', part);
    const skuMatch = /\bskus?=["']([^"']+)["']/i.exec(attrs);
    if (skuMatch) for (const part of skuMatch[1].split(',')) add('sku', part);
  }

  // Fallback: already-rendered shortcode output.
  const dataRe = /data-product_id=["']?(\d+)["']?/g;
  let d: RegExpExecArray | null;
  while ((d = dataRe.exec(content)) !== null) add('id', d[1]);

  return tokens;
}

/**
 * Replace `<!-- wp:block {"ref":N} /-->` references with the referenced
 * wp_block's content, recursively (depth-capped, cycle-guarded). Mirrors
 * WordPress do_blocks() so products embedded via reusable blocks are caught.
 */
function expandReusableBlocks(
  content: string,
  blockMap: Map<number, string>,
  depth = 0,
  visited = new Set<number>(),
): string {
  if (!content || depth > 5) return content;
  return content.replace(
    /<!--\s*wp:block\s+\{[^}]*"ref":(\d+)[^}]*\}\s*\/-->/g,
    (_whole, refStr: string) => {
      const ref = parseInt(refStr, 10);
      if (!ref || visited.has(ref)) return '';
      const inner = blockMap.get(ref);
      if (inner === undefined) return '';
      const next = new Set(visited);
      next.add(ref);
      return expandReusableBlocks(inner, blockMap, depth + 1, next);
    },
  );
}

async function main() {
  if (WRITE && !IS_LOCAL && !YES) {
    console.error(
      '\n⛔ Refusing to write to the REMOTE/production DB without --yes.\n' +
        '   Per the DB backup policy, create a fresh prod backup FIRST:\n' +
        '   ssh root@159.69.220.162 "mysqldump --ssl-mode=REQUIRED --no-tablespaces -u <user> -p\'<pass>\' -h 127.0.0.1 <db> --single-transaction --quick --lock-tables=false 2>/dev/null" | gzip -1 > backups/prod-backup-$(date +%Y%m%d_%H%M%S).sql.gz\n' +
        '   Then re-run with --write --yes.\n',
    );
    process.exit(1);
  }

  const db = await getConnection();
  const mode = WRITE ? '✍️  WRITE' : '🔍 DRY-RUN';
  console.log(`${mode}  category=${CATEGORY ?? '(all)'}  overwrite=${OVERWRITE}\n`);

  // 1. Build the product/variation lookup once.
  const [prodRows] = await db.query<(RowDataPacket & { ID: number; post_type: string; post_parent: number })[]>(
    `SELECT ID, post_type, post_parent FROM wp_posts
      WHERE post_type IN ('product','product_variation')
        AND post_status IN ('publish','private')`,
  );
  const productIds = new Set<number>();
  const variationParent = new Map<number, number>();
  for (const r of prodRows) {
    if (r.post_type === 'product') productIds.add(r.ID);
    else variationParent.set(r.ID, r.post_parent);
  }

  /** Map an extracted ID to a valid top-level product ID, or null to drop. */
  const toProductId = (id: number): number | null => {
    if (productIds.has(id)) return id;
    const parent = variationParent.get(id);
    if (parent && productIds.has(parent)) return parent;
    return null;
  };

  // 1b. Load all reusable blocks (wp_block) for ref expansion.
  const [blockRows] = await db.query<(RowDataPacket & { ID: number; post_content: string })[]>(
    `SELECT ID, post_content FROM wp_posts WHERE post_type = 'wp_block'`,
  );
  const blockMap = new Map<number, string>();
  for (const b of blockRows) blockMap.set(b.ID, b.post_content || '');
  console.log(`   loaded ${blockMap.size} reusable blocks for ref expansion\n`);

  // 2. Fetch candidate posts.
  const params: unknown[] = [];
  let where = `p.post_type = 'post' AND p.post_status = 'publish'`;
  if (CATEGORY) {
    where += ` AND p.ID IN (
      SELECT tr.object_id FROM wp_term_relationships tr
      JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      JOIN wp_terms t ON tt.term_id = t.term_id
      WHERE tt.taxonomy = 'category' AND t.slug = ?)`;
    params.push(CATEGORY);
  }
  const limitClause = LIMIT ? ` LIMIT ${LIMIT}` : '';

  const [posts] = await db.query<(RowDataPacket & { ID: number; post_title: string; post_content: string })[]>(
    `SELECT p.ID, p.post_title, p.post_content FROM wp_posts p WHERE ${where} ORDER BY p.post_date DESC${limitClause}`,
    params,
  );

  // 3. Which posts already have the meta?
  const postIds = posts.map(p => p.ID);
  const existing = new Set<number>();
  if (postIds.length) {
    const [metaRows] = await db.query<(RowDataPacket & { post_id: number })[]>(
      `SELECT post_id FROM wp_postmeta WHERE meta_key = ? AND post_id IN (?) AND meta_value <> ''`,
      [PRODUCTS_META, postIds],
    );
    for (const m of metaRows) existing.add(m.post_id);
  }

  // First pass: parse tokens per post and collect all referenced SKUs.
  const perPost = new Map<number, Token[]>();
  const allSkus = new Set<string>();
  for (const post of posts) {
    const expanded = expandReusableBlocks(post.post_content, blockMap);
    const toks = extractTokens(expanded);
    if (toks.length) {
      perPost.set(post.ID, toks);
      for (const t of toks) if (t.type === 'sku') allSkus.add(t.value);
    }
  }

  // Resolve SKUs → post ID in a single query (covers products & variations).
  const skuToPostId = new Map<string, number>();
  if (allSkus.size) {
    const [skuRows] = await db.query<(RowDataPacket & { meta_value: string; post_id: number })[]>(
      `SELECT meta_value, post_id FROM wp_postmeta WHERE meta_key = '_sku' AND meta_value IN (?)`,
      [[...allSkus]],
    );
    for (const r of skuRows) skuToPostId.set(r.meta_value, r.post_id);
  }

  let scanned = 0, matched = 0, written = 0, skipped = 0, unresolvedTotal = 0;

  for (const post of posts) {
    scanned++;
    const toks = perPost.get(post.ID);
    if (!toks || toks.length === 0) continue;

    const resolved: number[] = [];
    const unresolved: string[] = [];
    for (const t of toks) {
      const rawId = t.type === 'id' ? parseInt(t.value, 10) : skuToPostId.get(t.value);
      const productId = rawId ? toProductId(rawId) : null;
      if (productId) {
        if (!resolved.includes(productId)) resolved.push(productId);
      } else {
        unresolved.push(`${t.type}:${t.value}`);
      }
    }
    if (unresolved.length) {
      unresolvedTotal += unresolved.length;
      console.log(`   ⚠️  #${post.ID} unresolved: ${unresolved.join(', ')}`);
    }
    if (resolved.length === 0) continue;
    matched++;

    if (existing.has(post.ID) && !OVERWRITE) {
      skipped++;
      console.log(`⏭️  #${post.ID} "${post.post_title}" — already set, skipping (use --overwrite)`);
      continue;
    }

    const csv = resolved.join(',');
    console.log(`${WRITE ? '✅' : '•'} #${post.ID} "${post.post_title}" → ${csv}`);

    if (WRITE) {
      await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [post.ID, PRODUCTS_META]);
      await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [post.ID, PRODUCTS_META, csv]);
      written++;
    }
  }

  console.log(
    `\n📊 scanned=${scanned}  with-products=${matched}  ${WRITE ? `written=${written}` : 'would-write=' + (matched - skipped)}  skipped(existing)=${skipped}  unresolved-refs=${unresolvedTotal}`,
  );
  if (!WRITE) console.log('   (dry-run — re-run with --write to persist)');

  await db.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
