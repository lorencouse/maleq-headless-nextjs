'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';

interface VariationAttribute {
  name: string;
  value: string;
}

export interface Variation {
  id: string;
  sku: string;
  name: string;
  price: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  stockStatus: string;
  stockQuantity: number;
  attributes: VariationAttribute[];
}

interface VariationSelectorProps {
  variations: Variation[];
  onVariationChange?: (variation: Variation) => void;
}

export default function VariationSelector({
  variations,
  onVariationChange
}: VariationSelectorProps) {
  // Get all unique attribute names and their possible values
  const attributeOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();

    variations.forEach(variation => {
      variation.attributes.forEach(attr => {
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
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>(() => {
    // Initialize with first variation's attributes
    const initial: Record<string, string> = {};
    variations[0]?.attributes.forEach(attr => {
      initial[attr.name] = attr.value;
    });
    return initial;
  });

  // Find the matching variation based on selected attributes
  const selectedVariation = useMemo(() => {
    return variations.find(variation =>
      variation.attributes.every(attr =>
        selectedAttributes[attr.name] === attr.value
      )
    );
  }, [selectedAttributes, variations]);

  // Handle attribute selection
  const handleAttributeSelect = (attributeName: string, value: string) => {
    const newSelection = {
      ...selectedAttributes,
      [attributeName]: value,
    };
    setSelectedAttributes(newSelection);

    // Find and notify about the new variation
    const newVariation = variations.find(variation =>
      variation.attributes.every(attr =>
        newSelection[attr.name] === attr.value
      )
    );

    if (newVariation && onVariationChange) {
      onVariationChange(newVariation);
    }
  };

  // Check if a specific attribute value is available (in stock)
  const isAttributeAvailable = (attributeName: string, value: string) => {
    // Check if any variation with this attribute value is in stock
    return variations.some(variation =>
      variation.attributes.some(attr =>
        attr.name === attributeName && attr.value === value
      ) && (variation.stockStatus === 'IN_STOCK' || variation.stockStatus === 'LOW_STOCK')
    );
  };

  const formatPrice = (price: string | null | undefined) => {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      {/* Attribute Selectors */}
      {attributeOptions.map(({ name, values }) => (
        <div key={name}>
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            {name}
          </label>
          <div className="flex flex-wrap gap-2">
            {values.map(value => {
              const isSelected = selectedAttributes[name] === value;
              const isAvailable = isAttributeAvailable(name, value);

              return (
                <button
                  key={value}
                  onClick={() => handleAttributeSelect(name, value)}
                  disabled={!isAvailable}
                  className={`
                    px-4 py-2 border-2 rounded-lg font-medium transition-all
                    ${isSelected
                      ? 'border-blue-600 bg-blue-50 text-blue-900'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }
                    ${!isAvailable
                      ? 'opacity-40 cursor-not-allowed line-through'
                      : 'hover:shadow-sm'
                    }
                  `}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Selected Variation Info */}
      {selectedVariation && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm text-gray-600">Selected:</p>
              <p className="font-semibold text-gray-900">{selectedVariation.name}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">
                {formatPrice(selectedVariation.price)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-gray-600">SKU: {selectedVariation.sku}</p>
            <div className="flex items-center gap-2">
              {selectedVariation.stockStatus === 'IN_STOCK' ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-green-600 font-medium">In Stock</span>
                </>
              ) : selectedVariation.stockStatus === 'LOW_STOCK' ? (
                <>
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-yellow-600 font-medium">
                    Low Stock ({selectedVariation.stockQuantity} left)
                  </span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-red-600 font-medium">Out of Stock</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Variation Comparison Table (if there are multiple variations) */}
      {variations.length > 1 && variations.length <= 6 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900">
            Compare All Options
          </summary>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {attributeOptions.map(attr => (
                    <th key={attr.name} className="px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase">
                      {attr.name}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase">
                    Price
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase">
                    Stock
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {variations.map(variation => (
                  <tr
                    key={variation.id}
                    className={`
                      ${variation.id === selectedVariation?.id ? 'bg-blue-50' : ''}
                      hover:bg-gray-50
                    `}
                  >
                    {attributeOptions.map(attr => {
                      const attrValue = variation.attributes.find(a => a.name === attr.name)?.value || '-';
                      return (
                        <td key={attr.name} className="px-3 py-2 text-gray-900">
                          {attrValue}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 font-semibold text-gray-900">
                      {formatPrice(variation.price)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`
                        text-xs font-medium
                        ${variation.stockStatus === 'IN_STOCK' ? 'text-green-600' : ''}
                        ${variation.stockStatus === 'LOW_STOCK' ? 'text-yellow-600' : ''}
                        ${variation.stockStatus === 'OUT_OF_STOCK' ? 'text-red-600' : ''}
                      `}>
                        {variation.stockStatus === 'IN_STOCK' ? 'In Stock' : ''}
                        {variation.stockStatus === 'LOW_STOCK' ? `Low (${variation.stockQuantity})` : ''}
                        {variation.stockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : ''}
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
