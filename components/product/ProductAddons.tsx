'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ADDON_PRODUCTS,
  ADDON_BUNDLE,
  AddonProduct,
} from '@/lib/config/product-addons';

interface ProductAddonsProps {
  onAddonsChange: (addons: SelectedAddon[]) => void;
}

export interface SelectedAddon {
  id: string;
  productId: string;
  sku: string;
  slug: string;
  name: string;
  price: number;
  regularPrice: number;
  image?: string;
}

export default function ProductAddons({ onAddonsChange }: ProductAddonsProps) {
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [bundleSelected, setBundleSelected] = useState(false);

  // Calculate individual addons total
  const individualTotal = ADDON_PRODUCTS.reduce(
    (sum, addon) => sum + addon.price,
    0
  );

  // Notify parent of addon changes
  const notifyChange = useCallback(
    (addons: Set<string>, isBundle: boolean) => {
      if (isBundle) {
        // Bundle selected - send as single bundle item
        onAddonsChange([
          {
            id: ADDON_BUNDLE.id,
            productId: ADDON_BUNDLE.productId,
            sku: ADDON_BUNDLE.sku,
            slug: ADDON_BUNDLE.slug,
            name: ADDON_BUNDLE.name,
            price: ADDON_BUNDLE.price,
            regularPrice: ADDON_BUNDLE.regularPrice,
            image: ADDON_BUNDLE.image,
          },
        ]);
      } else if (addons.size > 0) {
        // Individual addons selected with regular addon price
        const selected = ADDON_PRODUCTS.filter((addon) => addons.has(addon.id)).map(
          (addon) => ({
            id: addon.id,
            productId: addon.productId,
            sku: addon.sku,
            slug: addon.slug,
            name: addon.name,
            price: addon.price,
            regularPrice: addon.regularPrice,
            image: addon.image,
          })
        );
        onAddonsChange(selected);
      } else {
        // Nothing selected
        onAddonsChange([]);
      }
    },
    [onAddonsChange]
  );

  // Handle individual addon toggle
  const handleAddonToggle = (addonId: string) => {
    // If bundle is selected, deselect it first
    if (bundleSelected) {
      setBundleSelected(false);
    }

    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(addonId)) {
        next.delete(addonId);
      } else {
        next.add(addonId);
      }
      return next;
    });
  };

  // Handle bundle toggle
  const handleBundleToggle = () => {
    if (bundleSelected) {
      // Deselecting bundle
      setBundleSelected(false);
      setSelectedAddons(new Set());
    } else {
      // Selecting bundle - clear individual selections
      setBundleSelected(true);
      setSelectedAddons(new Set());
    }
  };

  // Notify parent when selection changes
  useEffect(() => {
    notifyChange(selectedAddons, bundleSelected);
  }, [selectedAddons, bundleSelected, notifyChange]);

  // Calculate current selection total
  const currentTotal = bundleSelected
    ? ADDON_BUNDLE.price
    : ADDON_PRODUCTS.filter((addon) => selectedAddons.has(addon.id)).reduce(
        (sum, addon) => sum + addon.price,
        0
      );

  return (
    <div className="mb-8 p-6 bg-muted/50 rounded-xl border border-border">
      <div className="flex items-center gap-2 mb-4">
        <svg
          className="w-5 h-5 text-primary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
        </svg>
        <h3 className="text-lg font-semibold text-foreground">
          Enhance Your Experience
        </h3>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Add these essentials to your order:
      </p>

      {/* Individual Addons */}
      <div className="space-y-3 mb-4">
        {ADDON_PRODUCTS.map((addon) => (
          <AddonCheckbox
            key={addon.id}
            addon={addon}
            checked={selectedAddons.has(addon.id)}
            disabled={bundleSelected}
            onChange={() => handleAddonToggle(addon.id)}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="bg-muted/50 px-3 text-sm text-muted-foreground">
            or save with bundle
          </span>
        </div>
      </div>

      {/* Bundle Option */}
      <div
        className={`relative p-4 rounded-lg border-2 transition-all cursor-pointer ${
          bundleSelected
            ? 'border-primary bg-background'
            : 'border-border hover:border-primary/50 bg-background'
        }`}
        onClick={handleBundleToggle}
      >
        {/* Best Value Badge */}
        <div className="absolute -top-2.5 left-4">
          <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded-full">
            BEST VALUE
          </span>
        </div>

        <div className="flex items-start gap-3 pt-1">
          <div className="flex-shrink-0 mt-0.5">
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                bundleSelected
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground/50'
              }`}
            >
              {bundleSelected && (
                <svg
                  className="w-3 h-3 text-primary-foreground"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">
                {ADDON_BUNDLE.shortName}
              </span>
              <div className="text-right">
                <span className="font-bold text-primary">
                  +${ADDON_BUNDLE.price.toFixed(2)}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {ADDON_BUNDLE.description}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground line-through">
                ${individualTotal.toFixed(2)}
              </span>
              <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                Save ${ADDON_BUNDLE.savings.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Selection Summary */}
      {currentTotal > 0 && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Add-ons total:</span>
            <span className="font-semibold text-foreground">
              +${currentTotal.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual addon checkbox component
 */
interface AddonCheckboxProps {
  addon: AddonProduct;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}

function AddonCheckbox({
  addon,
  checked,
  disabled,
  onChange,
}: AddonCheckboxProps) {
  return (
    <label
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
        disabled
          ? 'opacity-50 cursor-not-allowed border-border bg-background'
          : checked
            ? 'border-primary bg-background'
            : 'border-border hover:border-primary/50 bg-background'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="sr-only"
        />
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            checked
              ? 'bg-primary border-primary'
              : 'border-muted-foreground/50'
          }`}
        >
          {checked && (
            <svg
              className="w-3 h-3 text-primary-foreground"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-foreground">{addon.shortName}</span>
          <span className="font-semibold text-primary">
            +${addon.price.toFixed(2)}
          </span>
        </div>
        {addon.description && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {addon.description}
          </p>
        )}
      </div>
    </label>
  );
}
