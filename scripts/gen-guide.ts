/**
 * Generate the editorial overlay for a "Best [X]" roundup guide.
 *
 * Reads a post's curated product ranking (_maleq_related_products), pulls live
 * product data from the DB, assigns rule-based awards, then uses the Claude API
 * to draft per-product verdict/pros/cons/bestFor + a guide-level FAQ and
 * methodology. Writes the result to the roundup meta keys the frontend reads
 * (see docs/BUYERS_GUIDE_SYSTEM.md and lib/db/post-relations.ts → loadGuide).
 *
 *   _maleq_guide_type     = 'roundup'
 *   _maleq_guide_entries  = JSON overlay keyed by product ID
 *   _maleq_guide_faq      = JSON [{q,a}]
 *   _maleq_guide_meta     = JSON { methodology, lastReviewed }
 *
 * The ranked product list itself (_maleq_related_products) is NOT modified —
 * curate it in the WP meta box first (or pass --ids to set it here).
 *
 * Usage (DB target follows scripts/lib/db.ts — REMOTE/prod by default):
 *   ANTHROPIC_API_KEY=... bun run scripts/gen-guide.ts --local --post 287          # dry-run, local
 *   ANTHROPIC_API_KEY=... bun run scripts/gen-guide.ts --local --slug best-glass-dildos-and-sex-toys --write
 *   ANTHROPIC_API_KEY=... bun run scripts/gen-guide.ts --post 287 --write --yes    # write to PROD (needs backup)
 *
 * Flags:
 *   --post N        Target post ID
 *   --slug S        Target post by slug (post_name) — alternative to --post
 *   --ids "1,2,3"   Override/set the ranked product list (writes _maleq_related_products too)
 *   --write         Persist meta (default: dry-run, prints the drafted overlay)
 *   --yes           Required to write to the REMOTE/prod DB (safety; create a backup first)
 *   --local         Target the local DB (Local by Flywheel)
 *   --model M       Claude model (default: claude-opus-4-8)
 *   --limit N       Cap products processed (testing)
 */
import type { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getConnection } from './lib/db';

const TYPE_META = '_maleq_guide_type';
const PRODUCTS_META = '_maleq_related_products';
const ENTRIES_META = '_maleq_guide_entries';
const FAQ_META = '_maleq_guide_faq';
const GMETA_META = '_maleq_guide_meta';

const argv = process.argv;
const WRITE = argv.includes('--write');
const YES = argv.includes('--yes');
const IS_LOCAL = argv.includes('--local') || process.env.MYSQL_LOCAL === '1';

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const POST_ID = flag('--post') ? parseInt(flag('--post')!, 10) : undefined;
const SLUG = flag('--slug');
const IDS_OVERRIDE = flag('--ids');
const MODEL = flag('--model') || 'claude-opus-4-8';
const LIMIT = flag('--limit') ? parseInt(flag('--limit')!, 10) : undefined;

// ─── Types ────────────────────────────────────────────────────────────────
interface ProductData {
  id: number;
  name: string;
  shortDescription: string;
  price: number | null;
  regularPrice: number | null;
  onSale: boolean;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  categories: string[];
  specs: { length?: string; color?: string; material?: string; volume?: string; flavor?: string };
}

// Claude output schema (kept simple — no string-length constraints; the SDK
// strips unsupported keywords and validates client-side).
const EntrySchema = z.object({
  productId: z.number(),
  award: z.string().nullable(),
  bestFor: z.string(),
  verdict: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
});
const GuideSchema = z.object({
  entries: z.array(EntrySchema),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  methodology: z.string(),
});
type GuideDraft = z.infer<typeof GuideSchema>;

// ─── DB helpers ─────────────────────────────────────────────────────────────
function parseCsvIds(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

async function resolvePostId(
  db: Awaited<ReturnType<typeof getConnection>>,
): Promise<number> {
  if (POST_ID) return POST_ID;
  if (!SLUG) throw new Error('Provide --post N or --slug S');
  const [rows] = await db.query<(RowDataPacket & { ID: number })[]>(
    `SELECT ID FROM wp_posts WHERE post_name = ? AND post_type = 'post' LIMIT 1`,
    [SLUG],
  );
  if (!rows.length) throw new Error(`No post found with slug "${SLUG}"`);
  return rows[0].ID;
}

async function loadProductData(
  db: Awaited<ReturnType<typeof getConnection>>,
  ids: number[],
): Promise<ProductData[]> {
  if (!ids.length) return [];

  const [rows] = await db.query<(RowDataPacket & Record<string, string | null>)[]>(
    `SELECT p.ID, p.post_title, p.post_excerpt,
            mp.meta_value AS price, mr.meta_value AS regular_price,
            ms.meta_value AS sale_price, ma.meta_value AS avg_rating,
            mc.meta_value AS review_count, mk.meta_value AS stock_status
       FROM wp_posts p
       LEFT JOIN wp_postmeta mp ON mp.post_id = p.ID AND mp.meta_key = '_price'
       LEFT JOIN wp_postmeta mr ON mr.post_id = p.ID AND mr.meta_key = '_regular_price'
       LEFT JOIN wp_postmeta ms ON ms.post_id = p.ID AND ms.meta_key = '_sale_price'
       LEFT JOIN wp_postmeta ma ON ma.post_id = p.ID AND ma.meta_key = '_wc_average_rating'
       LEFT JOIN wp_postmeta mc ON mc.post_id = p.ID AND mc.meta_key = '_wc_review_count'
       LEFT JOIN wp_postmeta mk ON mk.post_id = p.ID AND mk.meta_key = '_stock_status'
      WHERE p.ID IN (?)`,
    [ids],
  );

  // Terms (categories + attribute values) in one query.
  const [terms] = await db.query<(RowDataPacket & { pid: number; taxonomy: string; name: string })[]>(
    `SELECT tr.object_id AS pid, tt.taxonomy AS taxonomy, t.name AS name
       FROM wp_term_relationships tr
       JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
       JOIN wp_terms t ON t.term_id = tt.term_id
      WHERE tr.object_id IN (?)
        AND tt.taxonomy IN ('product_cat','pa_length','pa_color','pa_material','pa_volume','pa_flavor')`,
    [ids],
  );

  const cats = new Map<number, string[]>();
  const specOf = new Map<number, ProductData['specs']>();
  for (const t of terms) {
    if (t.taxonomy === 'product_cat') {
      const arr = cats.get(t.pid) ?? [];
      if (arr.length < 4) arr.push(t.name);
      cats.set(t.pid, arr);
    } else {
      const dim = t.taxonomy.replace('pa_', '') as keyof ProductData['specs'];
      const s = specOf.get(t.pid) ?? {};
      if (!s[dim]) s[dim] = t.name; // first term per dimension
      specOf.set(t.pid, s);
    }
  }

  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const num = (v: string | null) => {
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const byId = new Map<number, ProductData>();
  for (const r of rows) {
    const id = r.ID as unknown as number;
    const price = num(r.price);
    const regular = num(r.regular_price);
    const sale = num(r.sale_price);
    byId.set(id, {
      id,
      name: (r.post_title as string) || `Product ${id}`,
      shortDescription: stripHtml((r.post_excerpt as string) || '').slice(0, 400),
      price,
      regularPrice: regular,
      onSale: sale != null && sale > 0 && regular != null && sale < regular,
      rating: num(r.avg_rating) ?? 0,
      reviewCount: num(r.review_count) ?? 0,
      inStock: (r.stock_status ?? 'instock') !== 'outofstock',
      categories: cats.get(id) ?? [],
      specs: specOf.get(id) ?? {},
    });
  }

  // Preserve ranking order; drop ids that didn't resolve.
  return ids.map((id) => byId.get(id)).filter((p): p is ProductData => !!p);
}

// ─── Rule-based award suggestions ────────────────────────────────────────────
function suggestAwards(products: ProductData[]): Map<number, string> {
  const awards = new Map<number, string>();
  const taken = new Set<number>();
  const claim = (id: number | undefined, label: string) => {
    if (id != null && !taken.has(id)) {
      awards.set(id, label);
      taken.add(id);
    }
  };
  const inStock = products.filter((p) => p.inStock);

  // Best Overall → top-ranked (#1) if it has a decent rating, else highest rating.
  const byRating = [...products].sort(
    (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
  );
  claim((products[0]?.rating ?? 0) >= 4 ? products[0]?.id : byRating[0]?.id, 'Best Overall');

  // Best Budget → lowest non-zero price among in-stock.
  const priced = inStock.filter((p) => p.price != null && p.price > 0);
  const cheapest = [...priced].sort((a, b) => (a.price! - b.price!))[0];
  claim(cheapest?.id, 'Best Budget');

  // Most Popular → highest review count.
  const popular = [...products].sort((a, b) => b.reviewCount - a.reviewCount)[0];
  if ((popular?.reviewCount ?? 0) > 0) claim(popular?.id, 'Most Popular');

  return awards;
}

// ─── Claude draft ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert sex-toy and sexual-wellness product reviewer writing for Male Q, a frank, sex-positive, inclusive retailer. You write concise, specific, trustworthy buying advice — never generic filler.

You will be given the title of a "best of" roundup, its product category, and a ranked list of products with live data (price, average rating, review count, key specs, short description). Produce editorial copy for a programmatic comparison guide.

Rules:
- For EACH product, return: a one-to-two sentence "verdict" (why it earns its rank — ground it in the actual specs/price/rating, never invent features), a short "bestFor" phrase (e.g. "Beginners", "Temperature play", "Travel"), 2-4 "pros" and 1-2 "cons" (each a short phrase, not a sentence).
- Keep an "award" only on the products where one is suggested in the input; you may rename an award to fit better, or set it to null. Do not invent awards for products that weren't suggested one.
- Write 5 FAQ entries ("q"/"a") that a shopper for this category would actually ask (how to choose, safety/material, care, sizing, use) — answers 1-3 sentences, practical, category-specific.
- Write a 2-3 sentence "methodology" describing how Male Q selected and ranked these picks (hands-on testing, materials/body-safety, value, real customer ratings).
- Be tasteful and clinical-but-warm. No purple prose. No medical claims. Match each product to its real data.
- Return ONLY the structured object. Every product in the input MUST appear in "entries", keyed by its productId.`;

async function draftGuide(
  title: string,
  category: string,
  products: ProductData[],
  awards: Map<number, string>,
): Promise<GuideDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it before running, e.g.\n  ANTHROPIC_API_KEY=sk-ant-... bun run scripts/gen-guide.ts ...');
  }
  const client = new Anthropic({ apiKey });

  const productLines = products.map((p, i) => ({
    rank: i + 1,
    productId: p.id,
    name: p.name,
    price: p.price,
    onSale: p.onSale,
    rating: p.rating,
    reviewCount: p.reviewCount,
    inStock: p.inStock,
    specs: p.specs,
    suggestedAward: awards.get(p.id) ?? null,
    shortDescription: p.shortDescription || undefined,
  }));

  const userContent =
    `Guide title: ${title}\n` +
    `Category: ${category}\n\n` +
    `Products (in ranked order):\n${JSON.stringify(productLines, null, 2)}`;

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(GuideSchema) },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userContent }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused to generate this guide.');
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('Claude returned no parseable structured output (possibly truncated — raise max_tokens).');
  }
  return parsed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (WRITE && !IS_LOCAL && !YES) {
    console.error(
      '\n⛔ Refusing to write to the REMOTE/production DB without --yes.\n' +
        '   Per the DB backup policy, create a fresh prod backup FIRST (see CLAUDE.md),\n' +
        '   then re-run with --write --yes.\n',
    );
    process.exit(1);
  }

  const db = await getConnection();
  const postId = await resolvePostId(db);

  const [postRows] = await db.query<(RowDataPacket & { post_title: string })[]>(
    `SELECT post_title FROM wp_posts WHERE ID = ? LIMIT 1`,
    [postId],
  );
  if (!postRows.length) throw new Error(`Post #${postId} not found`);
  const title = postRows[0].post_title;

  // Ranking: --ids override, else the post's existing curated list.
  let ids: number[];
  if (IDS_OVERRIDE) {
    ids = parseCsvIds(IDS_OVERRIDE);
  } else {
    const [m] = await db.query<(RowDataPacket & { meta_value: string })[]>(
      `SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`,
      [postId, PRODUCTS_META],
    );
    ids = parseCsvIds(m[0]?.meta_value);
  }
  if (LIMIT) ids = ids.slice(0, LIMIT);
  if (!ids.length) {
    throw new Error(`Post #${postId} has no ${PRODUCTS_META} and no --ids given. Curate products first.`);
  }

  const products = await loadProductData(db, ids);
  if (!products.length) throw new Error('No products resolved from the ranked list.');
  const category = products[0].categories[0] ?? 'sex toys';

  console.log(`\n${WRITE ? '✍️  WRITE' : '🔍 DRY-RUN'}  post #${postId} "${title}"`);
  console.log(`   ${products.length} products · category="${category}" · model=${MODEL}\n`);

  const awards = suggestAwards(products);
  console.log('   Rule-based award suggestions:');
  for (const p of products) {
    if (awards.has(p.id)) console.log(`     • ${awards.get(p.id)} → #${p.id} ${p.name}`);
  }

  console.log('\n   Drafting editorial copy via Claude…');
  const draft = await draftGuide(title, category, products, awards);

  // Build the overlay keyed by product ID; fall back to rule-based award.
  const validIds = new Set(products.map((p) => p.id));
  const overlay: Record<string, unknown> = {};
  for (const e of draft.entries) {
    if (!validIds.has(e.productId)) continue;
    overlay[String(e.productId)] = {
      award: e.award ?? awards.get(e.productId) ?? undefined,
      bestFor: e.bestFor || undefined,
      verdict: e.verdict || undefined,
      pros: e.pros ?? [],
      cons: e.cons ?? [],
    };
  }

  const guideMeta = {
    methodology: draft.methodology,
    lastReviewed: new Date().toISOString().slice(0, 10),
  };

  // Preview
  console.log('\n── Drafted overlay (preview) ──');
  for (const p of products) {
    const e = overlay[String(p.id)] as { award?: string; bestFor?: string; verdict?: string; pros?: string[]; cons?: string[] } | undefined;
    if (!e) { console.log(`   #${p.id} ${p.name}  ⚠️ no entry returned`); continue; }
    console.log(`\n   #${p.id} ${p.name}${e.award ? `  [${e.award}]` : ''}`);
    if (e.bestFor) console.log(`     Best for: ${e.bestFor}`);
    if (e.verdict) console.log(`     ${e.verdict}`);
    if (e.pros?.length) console.log(`     + ${e.pros.join(' · ')}`);
    if (e.cons?.length) console.log(`     − ${e.cons.join(' · ')}`);
  }
  console.log(`\n── FAQ (${draft.faq.length}) ──`);
  for (const f of draft.faq) console.log(`   Q: ${f.q}\n   A: ${f.a}`);
  console.log(`\n── Methodology ──\n   ${guideMeta.methodology}\n`);

  if (!WRITE) {
    console.log('🔍 dry-run — re-run with --write to persist this overlay.\n');
    await db.end();
    return;
  }

  // Persist (upsert each meta key).
  const upsert = async (key: string, value: string) => {
    await db.query(`DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?`, [postId, key]);
    await db.query(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [postId, key, value]);
  };

  if (IDS_OVERRIDE) await upsert(PRODUCTS_META, ids.join(','));
  await upsert(TYPE_META, 'roundup');
  await upsert(ENTRIES_META, JSON.stringify(overlay));
  await upsert(FAQ_META, JSON.stringify(draft.faq));
  await upsert(GMETA_META, JSON.stringify(guideMeta));

  console.log(`✅ Wrote roundup meta for post #${postId}.`);
  console.log('   Remember to flush the WP object cache so the frontend sees it (wp cache flush).\n');
  await db.end();
}

main().catch((err) => {
  console.error('\ngen-guide failed:', err.message);
  process.exit(1);
});
