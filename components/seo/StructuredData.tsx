import Script from 'next/script';

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
    <Script
      id="organization-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="website-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="brand-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="product-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="article-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="breadcrumb-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="itemlist-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
    <Script
      id="faq-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
