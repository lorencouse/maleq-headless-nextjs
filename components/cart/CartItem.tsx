'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CartItem as CartItemType } from '@/lib/types/cart';
import { useCartStore } from '@/lib/store/cart-store';
import { formatPrice, calculateSavings } from '@/lib/utils/cart-helpers';
import QuantitySelector from '@/components/ui/QuantitySelector';

// Build WordPress base URL for images
const wpBaseUrl = (process.env.NEXT_PUBLIC_WORDPRESS_API_URL || '').replace('/graphql', '');

/**
 * Get full image URL, handling relative paths
 */
function getImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${wpBaseUrl}${url}`;
}

interface CartItemProps {
  item: CartItemType;
}

export default function CartItem({ item }: CartItemProps) {
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const savings = calculateSavings(item.regularPrice, item.price);
  const hasSavings = savings > 0;

  const handleQuantityChange = (newQuantity: number) => {
    if (newQuantity >= 1 && newQuantity <= item.maxQuantity) {
      setIsUpdating(true);
      updateQuantity(item.id, newQuantity);
      setIsUpdating(false);
    }
  };

  const handleRemove = () => {
    removeItem(item.id);
    setShowRemoveConfirm(false);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4 py-6 border-b border-border">
      {/* Product Image */}
      <Link
        href={`/product/${item.slug}`}
        className="relative w-full sm:w-32 h-32 flex-shrink-0 bg-muted rounded-lg overflow-hidden group"
      >
        {item.image?.url ? (
          <Image
            src={getImageUrl(item.image.url)}
            alt={item.image.altText || item.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform"
            sizes="(max-width: 640px) 100vw, 128px"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            No Image
          </div>
        )}
      </Link>

      {/* Product Details */}
      <div className="flex-1 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          {/* Name */}
          <Link
            href={`/product/${item.slug}`}
            className="text-lg font-medium text-foreground hover:text-primary transition-colors"
          >
            {item.name}
          </Link>

          {/* Variation Attributes */}
          {item.attributes && Object.keys(item.attributes).length > 0 && (
            <div className="text-sm text-muted-foreground mt-1">
              {Object.entries(item.attributes).map(([key, value]) => (
                <span key={key} className="mr-3">
                  <span className="font-medium">{key}:</span> {value}
                </span>
              ))}
            </div>
          )}

          {/* SKU */}
          {item.sku && (
            <p className="text-xs text-muted-foreground mt-1">
              SKU: {item.sku}
            </p>
          )}

          {/* Price */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-lg font-semibold text-foreground">
              {formatPrice(item.price)}
            </span>
            {hasSavings && (
              <>
                <span className="text-sm text-muted-foreground line-through">
                  {formatPrice(item.regularPrice)}
                </span>
                <span className="text-xs text-primary font-medium">
                  Save {formatPrice(savings)}
                </span>
              </>
            )}
          </div>

          {/* Stock Warning */}
          {!item.inStock && (
            <p className="text-sm text-destructive mt-2">
              This item is out of stock
            </p>
          )}
          {item.inStock && item.stockQuantity && item.stockQuantity < 5 && (
            <p className="text-sm text-warning mt-2">
              Only {item.stockQuantity} left in stock
            </p>
          )}
        </div>

        {/* Quantity & Actions */}
        <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-2">
          {/* Quantity Selector */}
          <QuantitySelector
            quantity={item.quantity}
            min={1}
            max={item.maxQuantity}
            disabled={isUpdating}
            onQuantityChange={handleQuantityChange}
            onRemove={handleRemove}
            showInput
          />

          {/* Line Subtotal */}
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Subtotal</p>
            <p className="text-lg font-semibold text-foreground">
              {formatPrice(item.subtotal)}
            </p>
          </div>

          {/* Remove Button */}
          {showRemoveConfirm ? (
            <div className="flex items-center gap-3">
              <button
                onClick={handleRemove}
                className="px-3 py-2 min-h-[44px] text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowRemoveConfirm(false)}
                className="px-3 py-2 min-h-[44px] text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowRemoveConfirm(true)}
              className="px-3 py-2 min-h-[44px] text-sm text-muted-foreground hover:text-destructive hover:bg-muted rounded-lg transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
