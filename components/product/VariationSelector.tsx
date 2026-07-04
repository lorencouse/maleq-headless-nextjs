'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  formatAttributeName,
  formatAttributeValue,
  formatPrice,
} from '@/lib/utils/woocommerce-format';
import {
  useLocalizedColorName,
  useLocalizedMaterialName,
  useLocalizedFlavorName,
  useLocalizedAttributeName,
} from '@/lib/i18n/attribute-translations';
import { findDefaultVariation } from '@/lib/products/variation-utils';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { processContentImages } from '@/lib/utils/image';
import StockStatusBadge from '@/components/ui/StockStatusBadge';
import { formatSizeValue, isConvertibleSize } from '@/lib/products/size-units';
import { useUnitSystem } from '@/lib/hooks/useUnitSystem';
import UnitSystemToggle from '@/components/product/UnitSystemToggle';

interface VariationAttribute {
  name: string;
  value: string;
}

export interface Variation {
  id: string;
  databaseId?: number;
  sku: string;
  name: string;
  description?: string | null;
  price: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  stockStatus: string;
  stockQuantity: number;
  weight?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  attributes: VariationAttribute[];
  image?: {
    url: string;
    altText: string;
  } | null;
}

interface VariationSelectorProps {
  variations: Variation[];
  onVariationChange?: (variation: Variation) => void;
  externalSelectedVariationId?: string | null;
  defaultAttributes?: { name: string; value: string }[];
  /** Parent product name, used to build a localized "Selected: …" label. */
  productName?: string;
}

const DESCRIPTION_CLAMP_LINES = 4;

function VariationDescription({ description }: { description: string }) {
  const t = useTranslations('variations');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      // Check if content overflows when clamped
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20');
      const maxHeight = lineHeight * DESCRIPTION_CLAMP_LINES;
      setIsClamped(el.scrollHeight > maxHeight + 2);
    }
  }, [description]);

  return (
    <div className='pt-3 border-t border-border'>
      <p className='text-sm text-muted-foreground mb-1'>{t('descriptionLabel')}</p>
      <div
        ref={contentRef}
        className={`text-sm text-foreground leading-relaxed prose prose-sm max-w-none ${
          !isExpanded ? `line-clamp-[${DESCRIPTION_CLAMP_LINES}]` : ''
        }`}
        style={!isExpanded ? { WebkitLineClamp: DESCRIPTION_CLAMP_LINES, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
        dangerouslySetInnerHTML={{ __html: processContentImages(sanitizeHtml(description)) }}
      />
      {isClamped && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className='mt-1 text-sm text-primary hover:text-primary-hover font-medium transition-colors'
        >
          {isExpanded ? t('showLess') : t('readMore')}
        </button>
      )}
    </div>
  );
}

export default function VariationSelector({
  variations,
  onVariationChange,
  externalSelectedVariationId,
  defaultAttributes,
  productName,
}: VariationSelectorProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const t = useTranslations('variations');
  const localizeColorName = useLocalizedColorName();
  const localizeMaterialName = useLocalizedMaterialName();
  const localizeFlavorName = useLocalizedFlavorName();
  const localizeAttributeName = useLocalizedAttributeName();
  const [unitSystem, setUnitSystem] = useUnitSystem();

  // Localize an option value for color/material/flavor attributes via the slug
  // dictionaries; size length/volume values convert to the chosen unit system;
  // other attribute values (style, …) stay as-is.
  const localizeValue = (attrName: string, value: string) => {
    const an = attrName.toLowerCase().replace(/^pa_/, '');
    const slug = value.toLowerCase().replace(/\s+/g, '-');
    const formatted = formatAttributeValue(value);
    if (an === 'color') return localizeColorName(slug, formatted);
    if (an === 'material') return localizeMaterialName(slug, formatted);
    if (an === 'flavor') return localizeFlavorName(slug, formatted);
    if (an === 'size' || an === 'volume' || an === 'length') return formatSizeValue(value, unitSystem) ?? formatted;
    return formatted;
  };

  // Show the metric/imperial toggle next to a Size/Volume/Length selector only
  // when it has convertible values — apparel/pack sizes don't get it.
  const sizeIsConvertible = (attrName: string, values: string[]) =>
    ['size', 'volume', 'length'].includes(attrName.toLowerCase().replace(/^pa_/, '')) &&
    values.some((v) => isConvertibleSize(v));

  // Get all unique attribute names and their possible values
  const attributeOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();

    variations.forEach((variation) => {
      variation.attributes.forEach((attr) => {
        if (!options.has(attr.name)) {
          options.set(attr.name, new Set());
        }
        options.get(attr.name)!.add(attr.value);
      });
    });

    // Convert to array format for rendering
    return Array.from(options.entries()).map(([name, values]) => ({
      name,
      values: Array.from(values).sort((a, b) => {
        // Try to sort numerically if possible (e.g., "2 OZ" before "16 OZ")
        const aNum = parseFloat(a.match(/[\d.]+/)?.[0] || '0');
        const bNum = parseFloat(b.match(/[\d.]+/)?.[0] || '0');
        if (aNum && bNum) return aNum - bNum;
        return a.localeCompare(b);
      }),
    }));
  }, [variations]);

  // State to track selected attributes
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >(() => {
    // Try to initialize from URL params first (e.g., ?attribute_size=Large)
    const fromUrl: Record<string, string> = {};
    let hasUrlParams = false;

    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('attribute_')) {
        const attrName = key.replace('attribute_', '');
        // Find the actual attribute name (case-insensitive match)
        const matchingAttr = variations[0]?.attributes.find(
          (a) => a.name.toLowerCase().replace(/\s+/g, '-') === attrName.toLowerCase()
            || a.name.toLowerCase() === attrName.toLowerCase()
        );
        if (matchingAttr) {
          // Find matching value (case-insensitive)
          const allValues = new Set<string>();
          variations.forEach((v) =>
            v.attributes.forEach((a) => {
              if (a.name === matchingAttr.name) allValues.add(a.value);
            })
          );
          const matchedValue = Array.from(allValues).find(
            (v) => v.toLowerCase() === decodeURIComponent(value).toLowerCase()
          );
          if (matchedValue) {
            fromUrl[matchingAttr.name] = matchedValue;
            hasUrlParams = true;
          }
        }
      }
    }

    // If URL params matched a valid variation, use those
    if (hasUrlParams) {
      const urlVariation = variations.find((v) =>
        v.attributes.every((attr) => fromUrl[attr.name] === attr.value)
      );
      if (urlVariation) return fromUrl;
    }

    // Use shared default variation logic: default attrs → first in-stock → default OOS → first
    const initialVariation = findDefaultVariation(variations, defaultAttributes);

    const initial: Record<string, string> = {};
    initialVariation?.attributes.forEach((attr) => {
      initial[attr.name] = attr.value;
    });
    return initial;
  });

  // Find the matching variation based on selected attributes
  const selectedVariation = useMemo(() => {
    return variations.find((variation) =>
      variation.attributes.every(
        (attr) => selectedAttributes[attr.name] === attr.value,
      ),
    );
  }, [selectedAttributes, variations]);

  // Call onVariationChange on mount with the initial variation
  // This ensures the parent components have the correct initial variation data
  useEffect(() => {
    if (selectedVariation && onVariationChange) {
      onVariationChange(selectedVariation);
    }
    // Only run on mount - we don't want to re-trigger when onVariationChange reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync internal state when a variation is selected externally (e.g. from gallery thumbnail)
  useEffect(() => {
    if (!externalSelectedVariationId) return;

    const externalVariation = variations.find(v => v.id === externalSelectedVariationId);
    if (!externalVariation || externalVariation.id === selectedVariation?.id) return;

    const newAttrs: Record<string, string> = {};
    externalVariation.attributes.forEach((attr) => {
      newAttrs[attr.name] = attr.value;
    });
    setSelectedAttributes(newAttrs);
    updateUrlParams(newAttrs);

    if (onVariationChange) {
      onVariationChange(externalVariation);
    }
  }, [externalSelectedVariationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL params to reflect current selection.
  //
  // We deliberately use the History API instead of router.replace(): this page's
  // server component does NOT read searchParams, so a router navigation would
  // refetch the RSC payload for no benefit AND re-suspend the (fallback-less)
  // <Suspense> wrapping ProductDetailsWrapper in page.tsx — blanking the whole
  // gallery/details block on the first selection of each variation (worse on
  // products with many variations, where the refetch is slow enough to see).
  // history.replaceState updates the URL for shareable links while staying in
  // sync with useSearchParams, with no navigation and no flicker.
  const updateUrlParams = (attrs: Record<string, string>) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(searchParams.toString());
    // Remove old attribute_ params
    for (const key of Array.from(params.keys())) {
      if (key.startsWith('attribute_')) params.delete(key);
    }
    // Add current selection
    for (const [name, value] of Object.entries(attrs)) {
      const paramKey = `attribute_${name.toLowerCase().replace(/\s+/g, '-')}`;
      params.set(paramKey, value);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', `${pathname}${qs ? `?${qs}` : ''}`);
  };

  // Handle attribute selection
  const handleAttributeSelect = (attributeName: string, value: string) => {
    const newSelection = {
      ...selectedAttributes,
      [attributeName]: value,
    };
    setSelectedAttributes(newSelection);
    updateUrlParams(newSelection);

    // Find and notify about the new variation
    const newVariation = variations.find((variation) =>
      variation.attributes.every(
        (attr) => newSelection[attr.name] === attr.value,
      ),
    );

    if (newVariation && onVariationChange) {
      onVariationChange(newVariation);
    }
  };

  // Check if a specific attribute value is available (in stock)
  const isAttributeAvailable = (attributeName: string, value: string) => {
    // Check if any variation with this attribute value is in stock
    return variations.some(
      (variation) =>
        variation.attributes.some(
          (attr) => attr.name === attributeName && attr.value === value,
        ) &&
        (variation.stockStatus === 'IN_STOCK' ||
          variation.stockStatus === 'LOW_STOCK'),
    );
  };

  return (
    <div className='space-y-6 mt-6'>
      {/* Attribute Selectors */}
      {attributeOptions.map(({ name, values }) => (
        <div key={name} className='flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3'>
          <label className='text-lg sm:text-xl font-semibold text-foreground whitespace-nowrap'>
            {localizeAttributeName(name, formatAttributeName(name))}:
          </label>
          {sizeIsConvertible(name, values) && (
            <UnitSystemToggle system={unitSystem} onChange={setUnitSystem} />
          )}
          <div className='flex flex-wrap gap-2'>
            {values.map((value) => {
              const isSelected = selectedAttributes[name] === value;
              const isAvailable = isAttributeAvailable(name, value);

              return (
                <button
                  key={value}
                  onClick={() => handleAttributeSelect(name, value)}
                  className={`
                    px-3 sm:px-4 py-1.5 min-h-[44px] border-2 rounded-xl text-sm sm:text-base font-medium transition-colors
                    ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card text-foreground hover:border-muted-foreground'
                    }
                    ${!isAvailable ? 'opacity-70' : ''}
                  `}
                >
                  <span>{localizeValue(name, value)}</span>
                  {!isAvailable && (
                    <span className='block text-[10px] leading-tight text-destructive'>{t('outOfStockTag')}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Selected Variation Info */}
      {selectedVariation && (
        <div className='p-4 bg-input rounded-xl border border-border space-y-4'>
          {/* Header with name and price */}
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
            <div>
              <p className='text-sm text-muted-foreground'>{t('selectedLabel')}</p>
              <p className='font-semibold text-foreground text-sm sm:text-base'>
                {/* Rebuild as "{product} - {localized attribute values}" so the
                    variation part localizes; fall back to the stored name. */}
                {productName && selectedVariation.attributes.length > 0
                  ? `${productName} - ${selectedVariation.attributes
                      .map((attr) => localizeValue(attr.name, attr.value))
                      .join(', ')}`
                  : selectedVariation.name}
              </p>
            </div>
            <div className='sm:text-right'>
              {selectedVariation.salePrice && selectedVariation.regularPrice &&
               selectedVariation.salePrice !== selectedVariation.regularPrice ? (
                <div className='flex items-baseline gap-2 sm:justify-end'>
                  <p className='text-xl sm:text-2xl font-bold text-primary'>
                    {formatPrice(selectedVariation.salePrice)}
                  </p>
                  <p className='text-sm text-muted-foreground line-through'>
                    {formatPrice(selectedVariation.regularPrice)}
                  </p>
                </div>
              ) : (
                <p className='text-xl sm:text-2xl font-bold text-foreground'>
                  {formatPrice(selectedVariation.price)}
                </p>
              )}
            </div>
          </div>

          {/* SKU, Variation ID, and Stock Status */}
          <div className='flex items-center justify-between text-sm'>
            <p className='text-muted-foreground'>
              {t('skuLabel', { sku: selectedVariation.sku })}
              {selectedVariation.databaseId !== undefined && selectedVariation.databaseId > 0 && (
                <span className='ml-3'>{t('idLabel', { id: selectedVariation.databaseId })}</span>
              )}
            </p>
            <StockStatusBadge
              status={selectedVariation.stockStatus}
              quantity={selectedVariation.stockQuantity}
              showQuantity={selectedVariation.stockStatus === 'LOW_STOCK'}
              size='sm'
            />
          </div>

          {/* Weight and Dimensions */}
          {(selectedVariation.weight ||
            selectedVariation.length ||
            selectedVariation.width ||
            selectedVariation.height) && (
            <div className='pt-3 border-t border-border'>
              <div className='grid grid-cols-2 gap-3 text-sm'>
                {selectedVariation.weight && (
                  <div>
                    <span className='text-muted-foreground'>{t('weightLabel')}</span>{' '}
                    <span className='font-medium text-foreground'>
                      {t('weightValue', { value: selectedVariation.weight })}
                    </span>
                  </div>
                )}
                {selectedVariation.length && (
                  <div>
                    <span className='text-muted-foreground'>{t('lengthLabel')}</span>{' '}
                    <span className='font-medium text-foreground'>
                      {t('inchValue', { value: selectedVariation.length })}
                    </span>
                  </div>
                )}
                {selectedVariation.width && (
                  <div>
                    <span className='text-muted-foreground'>{t('widthLabel')}</span>{' '}
                    <span className='font-medium text-foreground'>
                      {t('inchValue', { value: selectedVariation.width })}
                    </span>
                  </div>
                )}
                {selectedVariation.height && (
                  <div>
                    <span className='text-muted-foreground'>{t('heightLabel')}</span>{' '}
                    <span className='font-medium text-foreground'>
                      {t('inchValue', { value: selectedVariation.height })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Variation Description */}
          {selectedVariation.description && (
            <VariationDescription
              key={selectedVariation.id}
              description={selectedVariation.description}
            />
          )}
        </div>
      )}

      {/* Variation Comparison Table (if there are multiple variations) */}

      {variations.length > 1 && variations.length <= 6 && (
        <details className='mt-6'>
          <summary className='cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors'>
            {t('compareAllOptions')}
          </summary>
          <div className='mt-4 overflow-x-auto rounded-lg border border-border'>
            <table className='min-w-full divide-y divide-border text-sm'>
              <thead className='bg-input'>
                <tr>
                  {attributeOptions.map((attr) => (
                    <th
                      key={attr.name}
                      className='px-3 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider'
                    >
                      {localizeAttributeName(attr.name, formatAttributeName(attr.name))}
                    </th>
                  ))}
                  <th className='px-3 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider'>
                    {t('tablePriceHeading')}
                  </th>
                  <th className='px-3 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider'>
                    {t('tableStockHeading')}
                  </th>
                </tr>
              </thead>
              <tbody className='bg-card divide-y divide-border'>
                {variations.map((variation) => (
                  <tr
                    key={variation.id}
                    className={`
                      ${variation.id === selectedVariation?.id ? 'bg-primary/5' : ''}
                      hover:bg-input/50 transition-colors
                    `}
                  >
                    {attributeOptions.map((attr) => {
                      const attrValue =
                        variation.attributes.find((a) => a.name === attr.name)
                          ?.value || '-';
                      return (
                        <td
                          key={attr.name}
                          className='px-3 py-2.5 text-foreground'
                        >
                          {attrValue !== '-'
                            ? localizeValue(attr.name, attrValue)
                            : '-'}
                        </td>
                      );
                    })}
                    <td className='px-3 py-2.5 font-semibold'>
                      {variation.salePrice && variation.regularPrice &&
                       variation.salePrice !== variation.regularPrice ? (
                        <div className='flex items-baseline gap-1.5'>
                          <span className='text-primary'>{formatPrice(variation.salePrice)}</span>
                          <span className='text-xs text-muted-foreground line-through'>{formatPrice(variation.regularPrice)}</span>
                        </div>
                      ) : (
                        <span className='text-foreground'>{formatPrice(variation.price)}</span>
                      )}
                    </td>
                    <td className='px-3 py-2.5'>
                      <span
                        className={`
                        text-xs font-medium
                        ${variation.stockStatus === 'IN_STOCK' ? 'text-success' : ''}
                        ${variation.stockStatus === 'LOW_STOCK' ? 'text-warning' : ''}
                        ${variation.stockStatus === 'OUT_OF_STOCK' ? 'text-destructive' : ''}
                      `}
                      >
                        {variation.stockStatus === 'IN_STOCK' ? t('stockInStock') : ''}
                        {variation.stockStatus === 'LOW_STOCK'
                          ? t('stockLow', { count: variation.stockQuantity })
                          : ''}
                        {variation.stockStatus === 'OUT_OF_STOCK'
                          ? t('stockOutOfStock')
                          : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
