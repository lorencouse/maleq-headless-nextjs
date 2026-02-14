/**
 * Generate product redirect mappings from V1 → V2 based on SKU matching.
 *
 * V1 (old.maleq.com): database `maleqdb`, table prefix `p1bJcx_`
 * V2 (wp.maleq.com):  database `maleq-wp`, table prefix `wp_`
 * Both on Hetzner server 159.69.220.162.
 *
 * Requires SSH tunnel: ssh -L 3307:127.0.0.1:3306 root@159.69.220.162
 *
 * Usage:
 *   bun scripts/generate-product-redirects.ts              # dry run
 *   bun scripts/generate-product-redirects.ts --execute     # write JSON output
 *   bun scripts/generate-product-redirects.ts --execute --format nextconfig  # write .ts
 *
 * Options:
 *   --output FILE   Output path       (default: scripts/output/product-redirects.json)
 *   --format        json | nextconfig  (default: json)
 *   --execute       Write output files (default: dry run)
 */

import mysql from 'mysql2/promise';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const outputPath = getFlag('--output') || 'scripts/output/product-redirects.json';
const format = (getFlag('--format') || 'json') as 'json' | 'nextconfig';
const execute = process.argv.includes('--execute');

// ---------------------------------------------------------------------------
// Database configs — same server, different databases & credentials
// ---------------------------------------------------------------------------

const tunnelBase = { host: '127.0.0.1', port: 3307 };

const v1Config = {
  ...tunnelBase,
  database: 'maleqdb',
  user: 'maleqcom',
  password: 'Snowdogs2@@',
};

const v2Config = {
  ...tunnelBase,
  database: 'maleq-wp',
  user: 'maleq-wp',
  password: 'S9meeDoehU8VPiHd1ByJ',
};

// Table prefixes
const V1_PREFIX = 'p1bJcx_';
const V2_PREFIX = 'wp_';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductRow {
  id: number;
  slug: string;
  title: string;
  sku: string | null;
  post_type: string;
  parent_id: number;
}

interface RedirectEntry {
  v1_slug: string;
  v2_slug: string;
  sku: string;
  v1_title: string;
  v2_title: string;
  match_type: 'product_sku' | 'variation_sku';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get all published products with their SKUs */
async function getProducts(db: mysql.Connection, prefix: string): Promise<ProductRow[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(`
    SELECT
      p.ID         AS id,
      p.post_name  AS slug,
      p.post_title AS title,
      p.post_type,
      p.post_parent AS parent_id,
      MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku
    FROM ${prefix}posts p
    LEFT JOIN ${prefix}postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type IN ('product', 'product_variation')
      AND p.post_status = 'publish'
    GROUP BY p.ID
  `);
  return rows as unknown as ProductRow[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔗 Connecting via SSH tunnel (port 3307)');
  console.log(`   V1: maleqdb (old.maleq.com) — prefix: ${V1_PREFIX}`);
  console.log(`   V2: maleq-wp (wp.maleq.com) — prefix: ${V2_PREFIX}`);
  console.log('');

  const v1Conn = await mysql.createConnection(v1Config);
  const v2Conn = await mysql.createConnection(v2Config);

  try {
    // --- Step 1: Load V1 products ---
    console.log('📦 Loading V1 products...');
    const v1Products = await getProducts(v1Conn, V1_PREFIX);
    const v1Simple = v1Products.filter((p) => p.post_type === 'product');
    const v1Variations = v1Products.filter((p) => p.post_type === 'product_variation');
    console.log(`   ${v1Simple.length} products, ${v1Variations.length} variations`);

    // --- Step 2: Load V2 products ---
    console.log('📦 Loading V2 products...');
    const v2Products = await getProducts(v2Conn, V2_PREFIX);
    const v2Simple = v2Products.filter((p) => p.post_type === 'product');
    const v2Variations = v2Products.filter((p) => p.post_type === 'product_variation');
    console.log(`   ${v2Simple.length} products, ${v2Variations.length} variations`);

    // --- Step 3: Build V2 SKU lookup maps ---
    const v2SkuToProduct = new Map<string, { slug: string; title: string }>();
    for (const p of v2Simple) {
      if (p.sku) {
        v2SkuToProduct.set(p.sku, { slug: p.slug, title: p.title });
      }
    }

    const v2IdToProduct = new Map<number, { slug: string; title: string }>();
    for (const p of v2Simple) {
      v2IdToProduct.set(p.id, { slug: p.slug, title: p.title });
    }

    const v2VariationSkuToParent = new Map<string, { slug: string; title: string }>();
    for (const v of v2Variations) {
      if (v.sku && v.parent_id) {
        const parent = v2IdToProduct.get(v.parent_id);
        if (parent) {
          v2VariationSkuToParent.set(v.sku, parent);
        }
      }
    }

    console.log(`   V2 SKU index: ${v2SkuToProduct.size} product SKUs, ${v2VariationSkuToParent.size} variation SKUs`);
    console.log('');

    // --- Step 4: Build V1 product ID → slug map (for variation parent lookup) ---
    const v1IdToSlug = new Map<number, string>();
    for (const p of v1Simple) {
      v1IdToSlug.set(p.id, p.slug);
    }

    // --- Step 5: Match V1 products to V2 by SKU ---
    console.log('🔍 Matching V1 → V2 by SKU...');
    const redirects: RedirectEntry[] = [];
    const noSkuV1: ProductRow[] = [];
    const unmatchedV1: { slug: string; title: string; sku: string }[] = [];
    const sameSlug: { slug: string; sku: string }[] = [];

    // 5a: Match V1 simple products by their SKU
    for (const v1 of v1Simple) {
      if (!v1.sku) {
        noSkuV1.push(v1);
        continue;
      }

      // Try V2 simple products first
      const v2Match = v2SkuToProduct.get(v1.sku);
      if (v2Match) {
        if (v1.slug === v2Match.slug) {
          sameSlug.push({ slug: v1.slug, sku: v1.sku });
        } else {
          redirects.push({
            v1_slug: v1.slug,
            v2_slug: v2Match.slug,
            sku: v1.sku,
            v1_title: v1.title,
            v2_title: v2Match.title,
            match_type: 'product_sku',
          });
        }
        continue;
      }

      // Try V2 variations (SKU might be on a variation in V2)
      const v2VarMatch = v2VariationSkuToParent.get(v1.sku);
      if (v2VarMatch) {
        if (v1.slug === v2VarMatch.slug) {
          sameSlug.push({ slug: v1.slug, sku: v1.sku });
        } else {
          redirects.push({
            v1_slug: v1.slug,
            v2_slug: v2VarMatch.slug,
            sku: v1.sku,
            v1_title: v1.title,
            v2_title: v2VarMatch.title,
            match_type: 'variation_sku',
          });
        }
        continue;
      }

      unmatchedV1.push({ slug: v1.slug, title: v1.title, sku: v1.sku });
    }

    // 5b: Match via V1 variations — catches parent slug changes
    //     when the V1 product itself had no SKU but its variations did
    const variationRedirects: RedirectEntry[] = [];
    for (const v1Var of v1Variations) {
      if (!v1Var.sku || !v1Var.parent_id) continue;
      const v1ParentSlug = v1IdToSlug.get(v1Var.parent_id);
      if (!v1ParentSlug) continue;

      let v2Slug: string | undefined;
      let v2Title: string | undefined;
      let matchType: 'product_sku' | 'variation_sku' = 'product_sku';

      const v2Match = v2SkuToProduct.get(v1Var.sku);
      if (v2Match) {
        v2Slug = v2Match.slug;
        v2Title = v2Match.title;
      } else {
        const v2VarMatch = v2VariationSkuToParent.get(v1Var.sku);
        if (v2VarMatch) {
          v2Slug = v2VarMatch.slug;
          v2Title = v2VarMatch.title;
          matchType = 'variation_sku';
        }
      }

      if (v2Slug && v1ParentSlug !== v2Slug) {
        const alreadyRedirected = redirects.some((r) => r.v1_slug === v1ParentSlug);
        if (!alreadyRedirected) {
          variationRedirects.push({
            v1_slug: v1ParentSlug,
            v2_slug: v2Slug,
            sku: v1Var.sku,
            v1_title: `(via variation) ${v1ParentSlug}`,
            v2_title: v2Title || '',
            match_type: matchType,
          });
        }
      }
    }

    // Deduplicate variation-based redirects
    const seenV1Slugs = new Set(redirects.map((r) => r.v1_slug));
    for (const vr of variationRedirects) {
      if (!seenV1Slugs.has(vr.v1_slug)) {
        redirects.push(vr);
        seenV1Slugs.add(vr.v1_slug);
      }
    }

    // --- Step 6: Report ---
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  PRODUCT REDIRECT REPORT');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ✅ Redirects needed (slug changed):  ${redirects.length}`);
    console.log(`  ✅ Same slug (no redirect needed):    ${sameSlug.length}`);
    console.log(`  ⚠️  No SKU in V1 (can't match):       ${noSkuV1.length}`);
    console.log(`  ❌ SKU not found in V2:               ${unmatchedV1.length}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    if (redirects.length > 0) {
      console.log('📋 Sample redirects (first 20):');
      for (const r of redirects.slice(0, 20)) {
        console.log(`   /product/${r.v1_slug}  →  /product/${r.v2_slug}`);
        console.log(`     SKU: ${r.sku} | Match: ${r.match_type}`);
      }
      console.log('');
    }

    if (unmatchedV1.length > 0) {
      console.log(`⚠️  Unmatched V1 products (first 20 of ${unmatchedV1.length}):`);
      for (const u of unmatchedV1.slice(0, 20)) {
        console.log(`   ${u.slug} (SKU: ${u.sku}) — "${u.title}"`);
      }
      console.log('');
    }

    if (noSkuV1.length > 0) {
      console.log(`⚠️  V1 products without SKU (first 10 of ${noSkuV1.length}):`);
      for (const p of noSkuV1.slice(0, 10)) {
        console.log(`   ${p.slug} — "${p.title}"`);
      }
      console.log('');
    }

    // --- Step 7: Output ---
    if (!execute) {
      console.log('🔒 DRY RUN — use --execute to write output files');
      console.log(`   Would write ${redirects.length} redirects to: ${outputPath}`);
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });

      if (format === 'json') {
        const output = {
          generated: new Date().toISOString(),
          v1_db: 'maleqdb',
          v2_db: 'maleq-wp',
          stats: {
            redirects: redirects.length,
            same_slug: sameSlug.length,
            no_sku: noSkuV1.length,
            unmatched: unmatchedV1.length,
          },
          redirects: redirects.map((r) => ({
            source: `/product/${r.v1_slug}`,
            destination: `/product/${r.v2_slug}`,
            sku: r.sku,
            match_type: r.match_type,
          })),
          unmatched: unmatchedV1,
          no_sku: noSkuV1.map((p) => ({ slug: p.slug, title: p.title })),
        };
        writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`✅ Wrote JSON redirects to: ${outputPath}`);
      } else {
        const tsPath = outputPath.replace(/\.json$/, '.ts');
        const lines = [
          '// Auto-generated product redirects from V1 → V2 SKU matching',
          `// Generated: ${new Date().toISOString()}`,
          `// V1: maleqdb (old.maleq.com), V2: maleq-wp (wp.maleq.com)`,
          `// ${redirects.length} redirects`,
          '',
          'import type { Redirect } from "next/dist/lib/load-custom-routes";',
          '',
          'export const productRedirects: Redirect[] = [',
        ];
        for (const r of redirects) {
          lines.push('  {');
          lines.push(`    source: '/product/${r.v1_slug}',`);
          lines.push(`    destination: '/product/${r.v2_slug}',`);
          lines.push('    permanent: true,');
          lines.push('  },');
        }
        lines.push('];');
        lines.push('');
        writeFileSync(tsPath, lines.join('\n'));
        console.log(`✅ Wrote TypeScript redirects to: ${tsPath}`);
        console.log('');
        console.log('To use in next.config.ts:');
        console.log("  import { productRedirects } from './scripts/output/product-redirects';");
        console.log('  async redirects() {');
        console.log('    return [...productRedirects, ...otherRedirects];');
        console.log('  }');
      }

      // Always write unmatched report
      const unmatchedPath = outputPath.replace(/\.(json|ts)$/, '-unmatched.json');
      writeFileSync(
        unmatchedPath,
        JSON.stringify(
          {
            unmatched: unmatchedV1,
            no_sku: noSkuV1.map((p) => ({ slug: p.slug, title: p.title })),
          },
          null,
          2
        )
      );
      console.log(`📄 Wrote unmatched report to: ${unmatchedPath}`);
    }
  } finally {
    await v1Conn.end();
    await v2Conn.end();
  }
}

main().catch((err) => {
  console.error('💥 Fatal error:', err.message || err);
  process.exit(1);
});
