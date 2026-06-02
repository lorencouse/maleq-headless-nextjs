/**
 * Resolve the manufacturer's product-page URL for a local shop product.
 *
 * Precedence:
 *   1. An explicit per-product override (`_maleq_mfr_url` postmeta).
 *   2. The product's brand URL template (`maleq_brand_product_url_template`
 *      termmeta) with `{sku}` substituted for the product SKU.
 *   3. Nothing — returns null.
 *
 * See docs/BUYERS_GUIDE_SYSTEM.md-adjacent note and the maleq-brand-meta
 * mu-plugin for where the source meta is stored.
 */
export interface ManufacturerUrlInput {
  /** Product SKU used to fill a `{sku}` template placeholder. */
  sku?: string | null;
  /** Explicit per-product manufacturer URL (`_maleq_mfr_url`). */
  override?: string | null;
  /** Brand URL template containing a `{sku}` placeholder. */
  template?: string | null;
}

export function buildManufacturerUrl({ sku, override, template }: ManufacturerUrlInput): string | null {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) return trimmedOverride;

  const trimmedTemplate = template?.trim();
  const trimmedSku = sku?.trim();
  if (trimmedTemplate && trimmedSku && trimmedTemplate.includes('{sku}')) {
    return trimmedTemplate.replace(/\{sku\}/g, encodeURIComponent(trimmedSku));
  }

  return null;
}
