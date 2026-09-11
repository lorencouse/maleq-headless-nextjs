/**
 * Audit the catalog for Stripe-restricted products (CBD/THC, vapes, paraphernalia,
 * poppers, drug-test evasion, enhancement pills) using the same rules the importers
 * enforce — lib/import/restricted-products.ts.
 *
 *   bun scripts/_audit-restricted-products.ts                 # PRODUCTION, read-only, over SSH (default)
 *   bun scripts/_audit-restricted-products.ts --apply         # …and unpublish the hits (draft + restorable postmeta)
 *   bun scripts/_audit-restricted-products.ts --json out.json # also write a machine-readable report
 *   bun scripts/_audit-restricted-products.ts --local         # local Local-by-Flywheel DB via scripts/lib/db.ts
 *   bun scripts/_audit-restricted-products.ts --tunnel        # production via SSH tunnel + REMOTE_MYSQL_* env (scripts/lib/db.ts)
 *
 * Default mode runs the SQL on the WordPress host (`ssh root@159.69.220.162`), reading
 * DB credentials from wp-config.php there — nothing secret is needed locally. The
 * description column is only fetched for rows matching DESCRIPTION_PREFILTER_REGEXP,
 * which keeps the transfer to a few MB.
 *
 * --apply is a production write: take a backup first (scripts/ops/prod-backup.sh),
 * review the dry run, and afterwards run scripts/ops/revalidate-frontend.sh so Next.js
 * drops its caches (then purge Cloudflare). Anything the rules get wrong belongs in
 * data/restricted-allowlist.json, not in a one-off edit here.
 */
import { writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  checkRestrictedProduct,
  describeRestriction,
  loadRestrictedAllowlist,
  DESCRIPTION_PREFILTER_REGEXP,
  type RestrictedCategory,
  type RestrictedCheckResult,
} from '../lib/import/restricted-products';

const SSH_HOST = 'root@159.69.220.162';
const WP_CONFIG = '/home/maleq-wp/htdocs/wp.maleq.com/wp-config.php';

interface Row {
  ID: number;
  post_title: string;
  post_name: string;
  brand: string | null;
  cats: string[];
  sku: string | null;
  description: string;
}

interface Hit {
  id: number;
  slug: string;
  title: string;
  brand: string | null;
  sku: string | null;
  result: RestrictedCheckResult;
}

const APPLY = process.argv.includes('--apply');
const USE_DB_MODULE = process.argv.includes('--local') || process.argv.includes('--tunnel');
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx !== -1 ? process.argv[jsonIdx + 1] : null;
const TODAY = new Date().toISOString().slice(0, 10);

const TITLE_SQL = `
  SELECT p.ID, p.post_name,
         REPLACE(REPLACE(p.post_title,'\\t',' '),'\\n',' ') AS post_title,
         IFNULL(GROUP_CONCAT(DISTINCT IF(tt.taxonomy='product_brand', t.name, NULL)),'') AS brands,
         IFNULL(GROUP_CONCAT(DISTINCT IF(tt.taxonomy='product_cat',   t.name, NULL) SEPARATOR '|'),'') AS cats,
         IFNULL((SELECT meta_value FROM wp_postmeta pm WHERE pm.post_id=p.ID AND pm.meta_key='_sku' LIMIT 1),'') AS sku
    FROM wp_posts p
    LEFT JOIN wp_term_relationships tr ON tr.object_id = p.ID
    LEFT JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
         AND tt.taxonomy IN ('product_brand','product_cat')
    LEFT JOIN wp_terms t ON t.term_id = tt.term_id
   WHERE p.post_type = 'product' AND p.post_status = 'publish'
   GROUP BY p.ID`;

const DESC_SQL = `
  SELECT ID, REPLACE(REPLACE(REPLACE(CONCAT(IFNULL(post_excerpt,''),' ',IFNULL(post_content,'')),'\\t',' '),'\\r',' '),'\\n',' ')
    FROM wp_posts
   WHERE post_type = 'product' AND post_status = 'publish'
     AND CONCAT(IFNULL(post_excerpt,''),' ',IFNULL(post_content,'')) REGEXP ?`;

/** Bash that runs on the WP host: reads creds from wp-config, execs mysql with stdin SQL. */
function remoteMysqlWrapper(extraArgs = '-N --raw'): string {
  return [
    `CFG=${WP_CONFIG}`,
    `DB=$(grep -oP "DB_NAME',\\s*'\\K[^']+" "$CFG"); U=$(grep -oP "DB_USER',\\s*'\\K[^']+" "$CFG"); P=$(grep -oP "DB_PASSWORD',\\s*'\\K[^']+" "$CFG")`,
    `exec mysql --ssl-mode=REQUIRED -h 127.0.0.1 -u "$U" -p"$P" "$DB" ${extraArgs} 2>/dev/null`,
  ].join('\n');
}

/** Quote a JS string as a MySQL single-quoted literal (backslashes doubled so regex escapes survive). */
function sqlString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function runRemoteSql(sql: string): string {
  // The heredoc redirect must sit on the exec line itself.
  const script = remoteMysqlWrapper() + ` <<'MALEQ_SQL'\n${sql}\nMALEQ_SQL\n`;
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_HOST, 'bash -s'], {
    input: script,
    encoding: 'utf-8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`ssh/mysql failed (exit ${r.status}): ${r.stderr?.trim() || 'no stderr'}`);
  }
  return r.stdout;
}

function parseTitleRows(tsv: string): Row[] {
  const rows: Row[] = [];
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const [id, slug, title, brands, cats, sku] = line.split('\t');
    rows.push({
      ID: Number(id),
      post_name: slug ?? '',
      post_title: title ?? '',
      brand: brands ? brands.split(',')[0] : null,
      cats: cats ? cats.split('|').filter(Boolean) : [],
      sku: sku || null,
      description: '',
    });
  }
  return rows;
}

async function loadRowsViaSsh(): Promise<Row[]> {
  console.log(`Loading published products from production over SSH (${SSH_HOST})…`);
  const rows = parseTitleRows(runRemoteSql(TITLE_SQL));
  const descTsv = runRemoteSql(DESC_SQL.replace('?', sqlString(DESCRIPTION_PREFILTER_REGEXP)));
  let descCount = 0;
  const byId = new Map(rows.map((r) => [r.ID, r]));
  for (const line of descTsv.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const row = byId.get(Number(line.slice(0, tab)));
    if (row) {
      row.description = line.slice(tab + 1);
      descCount++;
    }
  }
  console.log(`  ${rows.length} published products, ${descCount} descriptions matched the prefilter\n`);
  return rows;
}

async function loadRowsViaDbModule(): Promise<{ rows: Row[]; db: import('mysql2/promise').Connection }> {
  const { getConnection } = await import('./lib/db');
  const db = await getConnection();
  console.log('Loading published products…');
  const [titleRows] = await db.query<any[]>(TITLE_SQL);
  const rows: Row[] = titleRows.map((r) => ({
    ID: Number(r.ID),
    post_name: r.post_name,
    post_title: r.post_title,
    brand: r.brands ? String(r.brands).split(',')[0] : null,
    cats: r.cats ? String(r.cats).split('|').filter(Boolean) : [],
    sku: r.sku || null,
    description: '',
  }));
  const [descRows] = await db.query<any[]>(DESC_SQL, [DESCRIPTION_PREFILTER_REGEXP]);
  const byId = new Map(rows.map((r) => [r.ID, r]));
  for (const d of descRows) {
    const row = byId.get(Number(d.ID));
    if (row) row.description = Object.values(d)[1] as string;
  }
  console.log(`  ${rows.length} published products, ${descRows.length} descriptions matched the prefilter\n`);
  return { rows, db };
}

function applySql(hits: Hit[]): string {
  const stamp = (h: Hit) => `restricted-${h.result.category}-${TODAY}`;
  const metaValues = hits
    .map((h) => `(${h.id},'_maleq_hidden_reason','${stamp(h)}'),(${h.id},'_maleq_hidden_prev_status','publish')`)
    .join(',\n  ');
  const ids = hits.map((h) => h.id).join(',');
  return `
INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES
  ${metaValues};
UPDATE wp_posts SET post_status='draft', post_modified=NOW(), post_modified_gmt=UTC_TIMESTAMP()
 WHERE ID IN (${ids}) AND post_type='product' AND post_status='publish';
SELECT CONCAT('drafted: ', ROW_COUNT());
SELECT CONCAT('still published from list: ', COUNT(*)) FROM wp_posts WHERE ID IN (${ids}) AND post_status='publish';
`;
}

async function main() {
  const allowlist = loadRestrictedAllowlist();

  let rows: Row[];
  let db: import('mysql2/promise').Connection | null = null;
  if (USE_DB_MODULE) {
    ({ rows, db } = await loadRowsViaDbModule());
  } else {
    rows = await loadRowsViaSsh();
  }

  const hits: Hit[] = [];
  const allowlisted: Hit[] = [];
  for (const r of rows) {
    const result = checkRestrictedProduct(
      { name: r.post_title, description: r.description, brand: r.brand, categories: r.cats, sku: r.sku },
      { allowlist },
    );
    const hit: Hit = { id: r.ID, slug: r.post_name, title: r.post_title, brand: r.brand, sku: r.sku, result };
    if (result.restricted) hits.push(hit);
    else if (result.allowlisted) allowlisted.push(hit);
  }

  // Report grouped by category
  const byCat = new Map<RestrictedCategory, Hit[]>();
  for (const h of hits) {
    const list = byCat.get(h.result.category!) ?? [];
    list.push(h);
    byCat.set(h.result.category!, list);
  }
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`== ${cat}: ${list.length}`);
    for (const h of list.sort((a, b) => a.title.localeCompare(b.title))) {
      console.log(`   ${String(h.id).padEnd(7)} ${h.title.substring(0, 60).padEnd(60)}  ${describeRestriction(h.result)}`);
    }
    console.log();
  }
  if (allowlisted.length) {
    console.log(`== allowlisted (matched a rule, kept on purpose): ${allowlisted.length}`);
    for (const h of allowlisted) console.log(`   ${h.id}  ${h.title.substring(0, 60)}  ${describeRestriction(h.result)}`);
    console.log();
  }
  console.log(`TOTAL restricted & published: ${hits.length}`);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), hits, allowlisted }, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }

  if (APPLY && hits.length) {
    console.log(`\n--apply: unpublishing ${hits.length} product(s)…`);
    if (db) {
      for (const h of hits) {
        await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?,?,?),(?,?,?)`, [
          h.id, '_maleq_hidden_reason', `restricted-${h.result.category}-${TODAY}`,
          h.id, '_maleq_hidden_prev_status', 'publish',
        ]);
        await db.query(
          `UPDATE wp_posts SET post_status='draft', post_modified=NOW(), post_modified_gmt=UTC_TIMESTAMP() WHERE ID=? AND post_status='publish'`,
          [h.id],
        );
      }
    } else {
      process.stdout.write(runRemoteSql(applySql(hits)));
    }
    console.log(`Done. Now flush the frontend:\n  ssh ${SSH_HOST} 'bash -s' < scripts/ops/revalidate-frontend.sh\nthen purge Cloudflare.`);
  } else if (APPLY) {
    console.log('\n--apply: nothing to do.');
  } else if (hits.length) {
    console.log('\nDry run. Re-run with --apply to unpublish (take a backup first: bash scripts/ops/prod-backup.sh).');
  }

  if (db) await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
