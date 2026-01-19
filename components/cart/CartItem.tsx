'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CartItem as CartItemType } from '@/lib/types/cart';
import { useCartStore } from '@/lib/store/cart-store';
import { formatPrice, calculateSavings } from '@/lib/utils/cart-helpers';

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

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuantity = parseInt(e.target.value) || 1;
    if (newQuantity >= 1 && newQuantity <= item.maxQuantity) {
      setIsUpdating(true);
      updateQuantity(item.id, newQuantity);
      setIsUpdating(false);
    }
  };

  const handleIncrement = () => {
    if (item.quantity < item.maxQuantity) {
      updateQuantity(item.id, item.quantity + 1);
    }
  };

  const handleDecrement = () => {
    if (item.quantity > 1) {
      updateQuantity(item.id, item.quantity - 1);
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
        href={`/shop/product/${item.slug}`}
        className="relative w-full sm:w-32 h-32 flex-shrink-0 bg-muted rounded-lg overflow-hidden group"
      >
        {item.image ? (
          <Image
            src={item.image.url}
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
            href={`/shop/product/${item.slug}`}
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
          <div className="flex items-center border border-border rounded-lg">
            <button
              onClick={handleDecrement}
              disabled={item.quantity <= 1 || isUpdating}
              className="px-3 py-2 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Decrease quantity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <input
              type="number"
              min="1"
              max={item.maxQuantity}
              value={item.quantity}
              onChange={handleQuantityChange}
              className="w-16 text-center py-2 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Quantity"
            />
            <button
              onClick={handleIncrement}
              disabled={item.quantity >= item.maxQuantity || isUpdating}
              className="px-3 py-2 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Increase quantity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Line Subtotal */}
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Subtotal</p>
            <p className="text-lg font-semibold text-foreground">
              {formatPrice(item.subtotal)}
            </p>
          </div>

          {/* Remove Button */}
          {showRemoveConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRemove}
                className="text-xs text-destructive hover:underline"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowRemoveConfirm(false)}
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowRemoveConfirm(true)}
              className="text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
