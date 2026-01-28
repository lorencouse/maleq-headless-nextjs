'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  formatAttributeName,
  formatAttributeValue,
  formatPrice,
} from '@/lib/utils/woocommerce-format';
import StockStatusBadge from '@/components/ui/StockStatusBadge';

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
  productId?: number; // Parent product database ID (for debugging)
}

export default function VariationSelector({
  variations,
  onVariationChange,
  productId,
}: VariationSelectorProps) {
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
    // Initialize with first in-stock variation's attributes, or first variation if none in stock
    const initialVariation = variations.find(
      v => v.stockStatus === 'IN_STOCK' || v.stockStatus === 'LOW_STOCK'
    ) || variations[0];

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

  // Handle attribute selection
  const handleAttributeSelect = (attributeName: string, value: string) => {
    const newSelection = {
      ...selectedAttributes,
      [attributeName]: value,
    };
    setSelectedAttributes(newSelection);

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
            {formatAttributeName(name)}:
          </label>
          <div className='flex flex-wrap gap-2'>
            {values.map((value) => {
              const isSelected = selectedAttributes[name] === value;
              const isAvailable = isAttributeAvailable(name, value);

              return (
                <button
                  key={value}
                  onClick={() => handleAttributeSelect(name, value)}
                  disabled={!isAvailable}
                  className={`
                    px-3 sm:px-4 py-2.5 min-h-[44px] border-2 rounded-xl text-sm sm:text-base font-medium transition-all
                    ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card text-foreground hover:border-muted-foreground'
                    }
                    ${
                      !isAvailable
                        ? 'opacity-40 cursor-not-allowed line-through'
                        : 'hover:shadow-sm'
                    }
                  `}
                >
                  {formatAttributeValue(value)}
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
              <p className='text-sm text-muted-foreground'>Selected:</p>
              <p className='font-semibold text-foreground text-sm sm:text-base'>
                {selectedVariation.name}
              </p>
            </div>
            <div className='sm:text-right'>
              <p className='text-xl sm:text-2xl font-bold text-foreground'>
                {formatPrice(selectedVariation.price)}
              </p>
            </div>
          </div>

          {/* SKU, Variation ID, and Stock Status */}
          <div className='flex items-center justify-between text-sm'>
            <p className='text-muted-foreground'>
              SKU: {selectedVariation.sku}
              {selectedVariation.databaseId !== undefined && selectedVariation.databaseId > 0 && (
                <span className='ml-3'>ID: {selectedVariation.databaseId}</span>
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
                    <span className='text-muted-foreground'>Weight:</span>{' '}
                    <span className='font-medium text-foreground'>
                      {selectedVariation.weight} lbs
                    </span>
                  </div>
                )}
                {selectedVariation.length && (
                  <div>
                    <span className='text-muted-foreground'>Length:</span>{' '}
                    <span className='font-medium text-foreground'>
                      {selectedVariation.length}&quot;
                    </span>
                  </div>
                )}
                {selectedVariation.width && (
                  <div>
                    <span className='text-muted-foreground'>Width:</span>{' '}
                    <span className='font-medium text-foreground'>
                      {selectedVariation.width}&quot;
                    </span>
                  </div>
                )}
                {selectedVariation.height && (
                  <div>
                    <span className='text-muted-foreground'>Height:</span>{' '}
                    <span className='font-medium text-foreground'>
                      {selectedVariation.height}&quot;
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Variation Description */}
          {selectedVariation.description && (
            <div className='pt-3 border-t border-border'>
              <p className='text-sm text-muted-foreground mb-1'>Description:</p>
              <p className='text-sm text-foreground leading-relaxed line-clamp-4'>
                {selectedVariation.description}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Variation Comparison Table (if there are multiple variations) */}
      {variations.length > 1 && variations.length <= 6 && (
        <details className='mt-6'>
          <summary className='cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors'>
            Compare All Options
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
                      {formatAttributeName(attr.name)}
                    </th>
                  ))}
                  <th className='px-3 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider'>
                    Price
                  </th>
                  <th className='px-3 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider'>
                    Stock
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
                            ? formatAttributeValue(attrValue)
                            : '-'}
                        </td>
                      );
                    })}
                    <td className='px-3 py-2.5 font-semibold text-foreground'>
                      {formatPrice(variation.price)}
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
                        {variation.stockStatus === 'IN_STOCK' ? 'In Stock' : ''}
                        {variation.stockStatus === 'LOW_STOCK'
                          ? `Low (${variation.stockQuantity})`
                          : ''}
                        {variation.stockStatus === 'OUT_OF_STOCK'
                          ? 'Out of Stock'
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
