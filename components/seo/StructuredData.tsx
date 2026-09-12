/**
 * Renders a JSON-LD block as a plain <script> in the server HTML.
 *
 * These components are server components, so a plain tag lands in the initial
 * HTML that crawlers fetch. Do NOT use next/script here: it injects the tag
 * client-side after hydration, which left every page with zero structured data
 * for non-JS crawlers (Bing, AI bots) and made Google's pickup depend on
 * rendering — verified live 2026-09-12 (SEO audit finding C2).
 *
 * `<` is escaped so a `</script>` inside a description can't break out of the
 * tag; JSON parsers read `\u003c` back as `<`.
 */
function JsonLd({ id, data }: { id: string; data: unknown }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}

interface OrganizationProps {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
  contactPoint?: {
    telephone?: string;
    email?: string;
    url?: string;
    contactType?: string;
  };
}

export function OrganizationSchema({ name, url, logo, sameAs, contactPoint }: OrganizationProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    ...(logo && { logo }),
    ...(sameAs && sameAs.length > 0 && { sameAs }),
    ...(contactPoint && {
      contactPoint: {
        '@type': 'ContactPoint',
        ...contactPoint,
      },
    }),
  };

  return (
    <JsonLd id="organization-schema" data={schema} />
  );
}

interface WebSiteProps {
  name: string;
  url: string;
  searchUrl?: string;
}

export function WebSiteSchema({ name, url, searchUrl }: WebSiteProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url,
    ...(searchUrl && {
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: searchUrl,
        },
        'query-input': 'required name=search_term_string',
      },
    }),
  };

  return (
    <JsonLd id="website-schema" data={schema} />
  );
}

interface BrandSchemaProps {
  /** Brand display name. */
  name: string;
  /** Canonical URL of the brand page on this site. */
  url: string;
  /** Manufacturer's official website + any other authoritative profiles. */
  sameAs?: string[];
  /** Plain-text brand description (HTML should be stripped by the caller). */
  description?: string;
  logo?: string;
}

/**
 * Brand entity for a brand archive page. The `sameAs` link to the
 * manufacturer's official site helps search engines disambiguate which
 * real-world brand this page represents (Knowledge Graph), without passing
 * link equity the way a visible <a> would.
 */
export function BrandSchema({ name, url, sameAs, description, logo }: BrandSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name,
    url,
    ...(description && { description }),
    ...(logo && { logo }),
    ...(sameAs && sameAs.length > 0 && { sameAs }),
  };

  return (
    <JsonLd id="brand-schema" data={schema} />
  );
}

interface ProductSchemaProps {
  name: string;
  description: string;
  image: string | string[];
  sku?: string;
  gtin?: string;
  brand?: string;
  price: number;
  priceCurrency?: string;
  salePrice?: number;
  availability: 'InStock' | 'OutOfStock' | 'PreOrder';
  url: string;
  category?: string;
  material?: string;
  color?: string;
  reviewCount?: number;
  ratingValue?: number;
}

export function ProductSchema({
  name,
  description,
  image,
  sku,
  gtin,
  brand,
  price,
  priceCurrency = 'USD',
  salePrice,
  availability,
  url,
  category,
  material,
  color,
  reviewCount,
  ratingValue,
}: ProductSchemaProps) {
  const availabilityUrl = {
    InStock: 'https://schema.org/InStock',
    OutOfStock: 'https://schema.org/OutOfStock',
    PreOrder: 'https://schema.org/PreOrder',
  };

  // Use sale price as the offer price when on sale, otherwise regular price
  const offerPrice = salePrice && salePrice > 0 ? salePrice : price;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    url,
    ...(sku && { sku }),
    ...(gtin && { gtin }),
    ...(brand && {
      brand: {
        '@type': 'Brand',
        name: brand,
      },
    }),
    ...(category && { category }),
    ...(material && { material }),
    ...(color && { color }),
    offers: {
      '@type': 'Offer',
      price: Number(offerPrice).toFixed(2),
      priceCurrency,
      availability: availabilityUrl[availability],
      itemCondition: 'https://schema.org/NewCondition',
      url,
      seller: {
        '@type': 'Organization',
        name: 'Male Q',
      },
    },
    ...(reviewCount &&
      ratingValue && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Number(ratingValue).toFixed(1),
          reviewCount,
        },
      }),
  };

  return (
    <JsonLd id="product-schema" data={schema} />
  );
}

interface ArticleSchemaProps {
  headline: string;
  description: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  url: string;
  keywords?: string[];
  articleSection?: string;
}

export function ArticleSchema({
  headline,
  description,
  image,
  datePublished,
  dateModified,
  authorName,
  url,
  keywords,
  articleSection,
}: ArticleSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline,
    description,
    ...(image && { image }),
    datePublished,
    ...(dateModified && { dateModified }),
    author: {
      '@type': 'Person',
      name: authorName,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Male Q',
      url: 'https://maleq.com',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    ...(keywords && keywords.length > 0 && { keywords: keywords.join(', ') }),
    ...(articleSection && { articleSection }),
  };

  return (
    <JsonLd id="article-schema" data={schema} />
  );
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function BreadcrumbSchema({ items }: { items: BreadcrumbItem[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <JsonLd id="breadcrumb-schema" data={schema} />
  );
}

// ─── Roundup ("Best [X]") guide schema ───────────────────────────────────────
// Emitted by the programmatic buyer's-guide layout. The ItemList expresses the
// ranking (so search/AI engines read "ranked list of N products"); each item is
// a nested Product with live offer + aggregateRating. The FAQ block feeds
// FAQPage. See docs/BUYERS_GUIDE_SYSTEM.md.

export interface ItemListProductItem {
  position: number;          // 1-based ranking
  name: string;
  url: string;               // canonical product URL
  image?: string;
  description?: string;
  brand?: string;
  sku?: string;
  price?: number;            // numeric offer price (sale price if on sale)
  priceCurrency?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
  ratingValue?: number;
  reviewCount?: number;
}

const AVAILABILITY_URL = {
  InStock: 'https://schema.org/InStock',
  OutOfStock: 'https://schema.org/OutOfStock',
  PreOrder: 'https://schema.org/PreOrder',
} as const;

export function ItemListSchema({
  items,
  name,
}: {
  items: ItemListProductItem[];
  name?: string;
}) {
  if (!items.length) return null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name && { name }),
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: items.length,
    itemListElement: items.map((it) => ({
      '@type': 'ListItem',
      position: it.position,
      item: {
        '@type': 'Product',
        name: it.name,
        url: it.url,
        ...(it.image && { image: it.image }),
        ...(it.description && { description: it.description }),
        ...(it.sku && { sku: it.sku }),
        ...(it.brand && { brand: { '@type': 'Brand', name: it.brand } }),
        ...(typeof it.price === 'number' && {
          offers: {
            '@type': 'Offer',
            price: it.price.toFixed(2),
            priceCurrency: it.priceCurrency ?? 'USD',
            availability: AVAILABILITY_URL[it.availability ?? 'InStock'],
            itemCondition: 'https://schema.org/NewCondition',
            url: it.url,
          },
        }),
        ...(it.ratingValue &&
          it.reviewCount && {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(it.ratingValue).toFixed(1),
              reviewCount: it.reviewCount,
            },
          }),
      },
    })),
  };

  return (
    <JsonLd id="itemlist-schema" data={schema} />
  );
}

export function FaqSchema({ faqs }: { faqs: { q: string; a: string }[] }) {
  if (!faqs.length) return null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a,
      },
    })),
  };

  return (
    <JsonLd id="faq-schema" data={schema} />
  );
}
