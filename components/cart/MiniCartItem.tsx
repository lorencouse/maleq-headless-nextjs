'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CartItem } from '@/lib/types/cart';
import { useCartStore } from '@/lib/store/cart-store';
import { formatPrice } from '@/lib/utils/cart-helpers';

interface MiniCartItemProps {
  item: CartItem;
}

export default function MiniCartItem({ item }: MiniCartItemProps) {
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleQuantityChange = async (newQuantity: number) => {
    if (newQuantity < 1 || newQuantity > item.maxQuantity) return;

    setIsUpdating(true);
    try {
      updateQuantity(item.id, newQuantity);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemove = () => {
    removeItem(item.id);
  };

  return (
    <div className="flex gap-3 py-3 border-b border-border last:border-0">
      {/* Product Image */}
      <div className="relative w-16 h-16 flex-shrink-0 bg-muted rounded-md overflow-hidden">
        {item.image ? (
          <Image
            src={item.image.url}
            alt={item.image.altText || item.name}
            fill
            className="object-cover"
            sizes="64px"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No Image
          </div>
        )}
      </div>

      {/* Product Details */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/product/${item.slug}`}
          className="text-sm font-medium text-foreground hover:text-primary line-clamp-2 transition-colors"
        >
          {item.name}
        </Link>

        {/* Variation Attributes */}
        {item.attributes && Object.keys(item.attributes).length > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            {Object.entries(item.attributes).map(([key, value]) => (
              <span key={key} className="mr-2">
                {key}: {value}
              </span>
            ))}
          </div>
        )}

        {/* Price */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-medium text-foreground">
            {formatPrice(item.price)}
          </span>
          {item.regularPrice > item.price && (
            <span className="text-xs text-muted-foreground line-through">
              {formatPrice(item.regularPrice)}
            </span>
          )}
        </div>

        {/* Quantity Controls */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center border border-border rounded">
            <button
              onClick={() => handleQuantityChange(item.quantity - 1)}
              disabled={item.quantity <= 1 || isUpdating}
              className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Decrease quantity"
            >
              -
            </button>
            <span className="px-3 py-1 text-sm font-medium min-w-[32px] text-center">
              {item.quantity}
            </span>
            <button
              onClick={() => handleQuantityChange(item.quantity + 1)}
              disabled={item.quantity >= item.maxQuantity || isUpdating}
              className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>

          {/* Remove Button */}
          <button
            onClick={handleRemove}
            className="text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Remove item"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
