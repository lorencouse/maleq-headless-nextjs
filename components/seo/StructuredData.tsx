import Script from 'next/script';

interface OrganizationProps {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
  contactPoint?: {
    telephone?: string;
    email?: string;
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

interface ProductSchemaProps {
  name: string;
  description: string;
  image: string | string[];
  sku?: string;
  brand?: string;
  price: number;
  priceCurrency?: string;
  availability: 'InStock' | 'OutOfStock' | 'PreOrder';
  url: string;
  reviewCount?: number;
  ratingValue?: number;
}

export function ProductSchema({
  name,
  description,
  image,
  sku,
  brand,
  price,
  priceCurrency = 'USD',
  availability,
  url,
  reviewCount,
  ratingValue,
}: ProductSchemaProps) {
  const availabilityUrl = {
    InStock: 'https://schema.org/InStock',
    OutOfStock: 'https://schema.org/OutOfStock',
    PreOrder: 'https://schema.org/PreOrder',
  };

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    url,
    ...(sku && { sku }),
    ...(brand && {
      brand: {
        '@type': 'Brand',
        name: brand,
      },
    }),
    offers: {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency,
      availability: availabilityUrl[availability],
      url,
    },
    ...(reviewCount &&
      ratingValue && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: ratingValue.toFixed(1),
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
