import Link from 'next/link';
import Image from 'next/image';
import {
  ItemListSchema,
  FaqSchema,
  type ItemListProductItem,
} from '@/components/seo/StructuredData';
import type { ResolvedGuide, GuideEntry, SpecColumn } from '@/lib/db/post-relations';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

/**
 * Programmatic "Best [X]" roundup layout. Driven entirely by ResolvedGuide
 * (lib/db/post-relations.ts → loadGuide): an editor-curated ranking + thin
 * editorial overlay, with all product data (price, rating, specs, image)
 * resolved LIVE from the index so the guide never goes stale.
 *
 * Renders, top-to-bottom: answer-first Top Picks box → comparison table →
 * ranked product cards → FAQ → methodology, plus ItemList + FAQPage JSON-LD.
 * See docs/BUYERS_GUIDE_SYSTEM.md.
 */

const STOCK_TO_AVAILABILITY: Record<string, ItemListProductItem['availability']> = {
  IN_STOCK: 'InStock',
  OUT_OF_STOCK: 'OutOfStock',
  ON_BACKORDER: 'PreOrder',
};

function productUrl(slug: string): string {
  return `${SITE_URL}/product/${slug}`;
}

/** Numeric offer price for schema: sale price when on sale, else regular. */
function offerPrice(entry: GuideEntry): number | undefined {
  const { onSale, salePrice, price } = entry.index;
  const value = onSale && salePrice != null ? salePrice : price;
  return value != null ? value : undefined;
}

// ─── Star rating (server-rendered, 0–5 scale) ────────────────────────────────
function StarRating({ value, reviewCount }: { value: number; reviewCount: number }) {
  const clamped = Math.max(0, Math.min(5, value));
  const pct = (clamped / 5) * 100;
  return (
    <span className="guide-stars" aria-label={`${clamped.toFixed(1)} out of 5`}>
      <span className="guide-stars__track" aria-hidden="true">★★★★★</span>
      <span className="guide-stars__fill" style={{ width: `${pct}%` }} aria-hidden="true">
        ★★★★★
      </span>
      <span className="guide-stars__num">
        {clamped.toFixed(1)}
        {reviewCount > 0 && <span className="guide-stars__count"> ({reviewCount})</span>}
      </span>
    </span>
  );
}

function AwardBadge({ award }: { award?: string }) {
  if (!award) return null;
  return <span className="guide-award">{award}</span>;
}

function PriceTag({ entry }: { entry: GuideEntry }) {
  const { product } = entry;
  if (!product.price) return <span className="guide-price guide-price--na">—</span>;
  return (
    <span className="guide-price">
      {product.onSale && product.regularPrice && (
        <span className="guide-price__was">{product.regularPrice}</span>
      )}
      <span className="guide-price__now">{product.price}</span>
    </span>
  );
}

// ─── Top Picks summary (answer-first, AEO) ────────────────────────────────────
function TopPicksSummary({ entries }: { entries: GuideEntry[] }) {
  const awarded = entries.filter((e) => e.award);
  const picks = awarded.length > 0 ? awarded : entries.slice(0, 3);
  if (picks.length === 0) return null;

  return (
    <aside className="guide-toppicks" aria-label="Our top picks">
      <h2 className="guide-toppicks__title">Our Top Picks</h2>
      <ul className="guide-toppicks__list">
        {picks.map((e) => (
          <li key={e.product.databaseId ?? e.rank}>
            {e.award && <strong className="guide-toppicks__award">{e.award}:</strong>}{' '}
            <a href={`#pick-${e.rank}`}>{e.product.name}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ─── Comparison table ─────────────────────────────────────────────────────────
function ComparisonTable({
  entries,
  columns,
}: {
  entries: GuideEntry[];
  columns: SpecColumn[];
}) {
  return (
    <div className="guide-table-wrap">
      <table className="guide-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Product</th>
            <th scope="col">Award</th>
            <th scope="col">Price</th>
            <th scope="col">Rating</th>
            {columns.map((c) => (
              <th scope="col" key={c.dim}>
                {c.label}
              </th>
            ))}
            <th scope="col"><span className="sr-only">Link</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.product.databaseId ?? e.rank}>
              <td className="guide-table__rank">{e.rank}</td>
              <th scope="row" className="guide-table__product">
                {e.product.image && (
                  <Image
                    src={e.product.image.url}
                    alt={e.product.image.altText || e.product.name}
                    width={48}
                    height={48}
                    className="guide-table__thumb"
                  />
                )}
                <a href={`#pick-${e.rank}`}>{e.product.name}</a>
              </th>
              <td>{e.award ?? '—'}</td>
              <td><PriceTag entry={e} /></td>
              <td><StarRating value={e.rating} reviewCount={e.reviewCount} /></td>
              {columns.map((c) => (
                <td key={c.dim}>{e.specs[c.dim] ?? '—'}</td>
              ))}
              <td>
                <Link className="guide-cta guide-cta--sm" href={`/product/${e.product.slug}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Ranked product card ──────────────────────────────────────────────────────
function RankedCard({ entry, columns }: { entry: GuideEntry; columns: SpecColumn[] }) {
  const { product } = entry;
  return (
    <section id={`pick-${entry.rank}`} className="guide-card" aria-label={`#${entry.rank} ${product.name}`}>
      <header className="guide-card__head">
        <span className="guide-card__rank">#{entry.rank}</span>
        <h3 className="guide-card__title">
          <Link href={`/product/${product.slug}`}>{product.name}</Link>
        </h3>
        <AwardBadge award={entry.award} />
      </header>

      <div className="guide-card__body">
        <div className="guide-card__media">
          {product.image && (
            <Link href={`/product/${product.slug}`}>
              <Image
                src={product.image.url}
                alt={product.image.altText || product.name}
                width={260}
                height={260}
                className="guide-card__img"
              />
            </Link>
          )}
          <StarRating value={entry.rating} reviewCount={entry.reviewCount} />
          <PriceTag entry={entry} />
          {entry.bestFor && <span className="guide-card__bestfor">Best for {entry.bestFor}</span>}
          <Link className="guide-cta" href={`/product/${product.slug}`}>
            View Product
          </Link>
        </div>

        <div className="guide-card__detail">
          {entry.verdict && <p className="guide-card__verdict">{entry.verdict}</p>}

          {(entry.pros.length > 0 || entry.cons.length > 0) && (
            <div className="pros-cons-wrapper">
              {entry.pros.length > 0 && (
                <ul className="pros-list">
                  {entry.pros.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {entry.cons.length > 0 && (
                <ul className="cons-list">
                  {entry.cons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {columns.length > 0 && (
            <dl className="guide-card__specs">
              {columns.map((c) => (
                <div key={c.dim} className="guide-card__spec">
                  <dt>{c.label}</dt>
                  <dd>{entry.specs[c.dim] ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ (native <details> — no JS, AEO-friendly) ─────────────────────────────
function GuideFaq({ faq }: { faq: { q: string; a: string }[] }) {
  if (faq.length === 0) return null;
  return (
    <section className="guide-faq" aria-label="Frequently asked questions">
      <h2>Frequently Asked Questions</h2>
      {faq.map((f, i) => (
        <details key={i} className="guide-faq__item">
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </section>
  );
}

function Methodology({ meta }: { meta: ResolvedGuide['meta'] }) {
  if (!meta.methodology && !meta.lastReviewed) return null;
  return (
    <section className="guide-method" aria-label="How we picked">
      {meta.methodology && (
        <>
          <h2>How We Picked</h2>
          <p>{meta.methodology}</p>
        </>
      )}
      {meta.lastReviewed && (
        <p className="guide-method__updated">
          Last reviewed:{' '}
          <time dateTime={meta.lastReviewed}>{meta.lastReviewed}</time>
        </p>
      )}
    </section>
  );
}

export default function BuyersGuide({
  guide,
  title,
}: {
  guide: ResolvedGuide;
  /** Used as the ItemList schema name (the guide's headline). */
  title?: string;
}) {
  if (guide.type !== 'roundup' || guide.entries.length === 0) return null;

  const schemaItems: ItemListProductItem[] = guide.entries.map((e) => ({
    position: e.rank,
    name: e.product.name,
    url: productUrl(e.product.slug),
    image: e.product.image?.url,
    description: e.verdict || e.product.shortDescription || undefined,
    brand: e.product.brands?.[0]?.name,
    price: offerPrice(e),
    priceCurrency: 'USD',
    availability: STOCK_TO_AVAILABILITY[e.index.stockStatus] ?? 'InStock',
    ratingValue: e.rating > 0 ? e.rating : undefined,
    reviewCount: e.reviewCount > 0 ? e.reviewCount : undefined,
  }));

  return (
    <div className="guide-roundup not-prose">
      <ItemListSchema items={schemaItems} name={title} />
      <FaqSchema faqs={guide.faq} />

      <TopPicksSummary entries={guide.entries} />
      <ComparisonTable entries={guide.entries} columns={guide.columns} />

      <div className="guide-cards">
        {guide.entries.map((e) => (
          <RankedCard key={e.product.databaseId ?? e.rank} entry={e} columns={guide.columns} />
        ))}
      </div>

      <GuideFaq faq={guide.faq} />
      <Methodology meta={guide.meta} />
    </div>
  );
}
