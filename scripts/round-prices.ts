/**
 * Round all existing product prices to psychological endings:
 *   - Regular prices → .97
 *   - Sale prices → .67 / .77 / .87 / .97 (round down)
 *   - _price (active price) follows sale price if sale exists, else regular
 *
 * Also updates parent variable products' _price to match their
 * cheapest variation's rounded price.
 *
 * Usage:
 *   bun run scripts/round-prices.ts --dry-run
 *   bun run scripts/round-prices.ts --apply
 */
import { getConnection } from './lib/db';

const dryRun = !process.argv.includes('--apply');

function roundUpTo97(price: number): number {
  const dollars = Math.floor(price);
  const cents = Math.round((price - dollars) * 100);
  if (cents <= 97) return dollars + 0.97;
  return dollars + 1 + 0.97;
}

function roundToSevenEnding(price: number): number {
  const dollars = Math.floor(price);
  const cents = Math.round((price - dollars) * 100);
  const endings = [67, 77, 87, 97];
  let bestEnding = 97;
  let bestDollars = dollars - 1;
  for (const ending of endings) {
    if (ending <= cents) {
      bestEnding = ending;
      bestDollars = dollars;
    }
  }
  if (bestDollars < 0) return 0.67;
  return bestDollars + bestEnding / 100;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

async function main() {
  const db = await getConnection();
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}\n`);

  // Get all products/variations with prices
  const [rows] = await db.query(`
    SELECT p.ID, p.post_type, p.post_title,
           reg.meta_value as regular_price,
           sale.meta_value as sale_price,
           pri.meta_value as active_price
    FROM wp_posts p
    LEFT JOIN wp_postmeta reg ON reg.post_id = p.ID AND reg.meta_key = '_regular_price'
    LEFT JOIN wp_postmeta sale ON sale.post_id = p.ID AND sale.meta_key = '_sale_price'
    LEFT JOIN wp_postmeta pri ON pri.post_id = p.ID AND pri.meta_key = '_price'
    WHERE p.post_type IN ('product', 'product_variation')
      AND p.post_status = 'publish'
    ORDER BY p.ID
  `) as [Array<{
    ID: number;
    post_type: string;
    post_title: string;
    regular_price: string | null;
    sale_price: string | null;
    active_price: string | null;
  }>, unknown];

  console.log(`Found ${rows.length} products/variations`);

  let regFixed = 0;
  let saleFixed = 0;
  let activeFixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const regVal = parseFloat(row.regular_price || '0');
    const saleVal = parseFloat(row.sale_price || '0');
    const activeVal = parseFloat(row.active_price || '0');

    // Skip products with no meaningful prices (parent variable products often have empty reg/sale)
    if (regVal <= 0 && saleVal <= 0) {
      skipped++;
      continue;
    }

    try {
      // Round regular price
      let newReg = regVal;
      if (regVal > 0) {
        newReg = roundUpTo97(regVal);
        if (fmt(newReg) !== (row.regular_price || '')) {
          if (!dryRun) {
            await db.query(
              `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_regular_price'`,
              [fmt(newReg), row.ID]
            );
          }
          regFixed++;
        }
      }

      // Round sale price
      let newSale = saleVal;
      if (saleVal > 0) {
        newSale = roundToSevenEnding(saleVal);

        // Ensure sale < regular
        if (newReg > 0 && newSale >= newReg) {
          // Drop to next lower ending
          newSale = roundToSevenEnding(newReg - 0.10);
        }

        if (fmt(newSale) !== (row.sale_price || '')) {
          if (!dryRun) {
            await db.query(
              `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_sale_price'`,
              [fmt(newSale), row.ID]
            );
          }
          saleFixed++;
        }
      }

      // Update active price (_price) to match
      const correctActive = newSale > 0 ? newSale : newReg;
      if (correctActive > 0 && fmt(correctActive) !== (row.active_price || '')) {
        if (!dryRun) {
          await db.query(
            `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
            [fmt(correctActive), row.ID]
          );
        }
        activeFixed++;
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  ERROR on ${row.ID}: ${(err as Error).message}`);
      }
    }
  }

  // Update parent variable products' _price to cheapest variation price
  console.log('\nUpdating parent variable product prices...');
  const [parents] = await db.query(`
    SELECT p.ID
    FROM wp_posts p
    JOIN wp_term_relationships tr ON tr.object_id = p.ID
    JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
    JOIN wp_terms t ON t.term_id = tt.term_id AND t.slug = 'variable'
    WHERE p.post_type = 'product' AND p.post_status = 'publish'
  `) as [Array<{ ID: number }>, unknown];

  let parentFixed = 0;
  for (const parent of parents) {
    const [varPrices] = await db.query(`
      SELECT MIN(CAST(pm.meta_value AS DECIMAL(10,2))) as min_price
      FROM wp_posts v
      JOIN wp_postmeta pm ON pm.post_id = v.ID AND pm.meta_key = '_price'
      WHERE v.post_parent = ? AND v.post_type = 'product_variation' AND v.post_status = 'publish'
        AND pm.meta_value != '' AND pm.meta_value > 0
    `, [parent.ID]) as [Array<{ min_price: number | null }>, unknown];

    const minPrice = parseFloat(String(varPrices[0]?.min_price ?? 0));
    if (minPrice > 0) {
      const [current] = await db.query(
        `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_price'`,
        [parent.ID]
      ) as [Array<{ meta_value: string }>, unknown];

      const currentPrice = parseFloat(current[0]?.meta_value || '0');
      if (current[0] && fmt(minPrice) !== fmt(currentPrice)) {
        if (!dryRun) {
          await db.query(
            `UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_price'`,
            [fmt(minPrice), parent.ID]
          );
        }
        parentFixed++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Regular prices rounded to .97: ${regFixed}`);
  console.log(`Sale prices rounded to .67/.77/.87/.97: ${saleFixed}`);
  console.log(`Active prices (_price) synced: ${activeFixed}`);
  console.log(`Parent variable prices synced: ${parentFixed}`);
  console.log(`Skipped (no price): ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (dryRun) {
    console.log('\nThis was a DRY RUN. Run with --apply to make changes.');
  }

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
