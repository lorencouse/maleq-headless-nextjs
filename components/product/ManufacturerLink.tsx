import { getTranslations } from 'next-intl/server';

/**
 * Link to this product's page on the manufacturer's website.
 *
 * The URL is resolved server-side (lib/products/manufacturer-url.ts) from the
 * product's `_maleq_mfr_url` override or the brand's product-URL template + SKU.
 * Renders nothing when no URL is available.
 *
 * Server component: the parent product page pre-seeds the request locale via
 * setRequestLocale, so getTranslations here stays static-safe under ISR.
 */
interface ManufacturerLinkProps {
  url: string | null | undefined;
  brandName?: string | null;
}

export default async function ManufacturerLink({ url, brandName }: ManufacturerLinkProps) {
  if (!url) return null;

  const t = await getTranslations('brands');

  return (
    <div className="mt-4">
      <a
        href={url}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="link-animated inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        {brandName
          ? t('viewOnBrandSite', { brand: brandName })
          : t('viewOnManufacturerSite')}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
