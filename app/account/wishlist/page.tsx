'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AccountLayout from '@/components/account/AccountLayout';
import { useWishlistStore, WishlistItem } from '@/lib/store/wishlist-store';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';

export default function WishlistPage() {
  const { items, removeItem, clearWishlist, hydrate } = useWishlistStore();
  const addToCart = useCartStore((state) => state.addItem);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrate();
    setMounted(true);
  }, [hydrate]);

  const handleAddToCart = (item: WishlistItem) => {
    try {
      addToCart({
        productId: item.productId,
        name: item.name,
        slug: item.slug,
        sku: '',
        price: item.price,
        regularPrice: item.regularPrice || item.price,
        quantity: 1,
        image: item.image,
        inStock: item.inStock,
        maxQuantity: 999,
      });
      showSuccess(`${item.name} added to cart!`);
    } catch (error) {
      showError('Failed to add to cart');
    }
  };

  const handleAddAllToCart = () => {
    const inStockItems = items.filter((item) => item.inStock);
    if (inStockItems.length === 0) {
      showError('No items in stock to add');
      return;
    }

    inStockItems.forEach((item) => {
      addToCart({
        productId: item.productId,
        name: item.name,
        slug: item.slug,
        sku: '',
        price: item.price,
        regularPrice: item.regularPrice || item.price,
        quantity: 1,
        image: item.image,
        inStock: item.inStock,
        maxQuantity: 999,
      });
    });

    showSuccess(`${inStockItems.length} items added to cart!`);
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  if (!mounted) {
    return (
      <AccountLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </AccountLayout>
    );
  }

  return (
    <AccountLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Wishlist</h1>
            <p className="text-muted-foreground">
              {items.length} {items.length === 1 ? 'item' : 'items'} saved
            </p>
          </div>
          {items.length > 0 && (
            <div className="flex gap-3">
              <button
                onClick={handleAddAllToCart}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium text-sm"
              >
                Add All to Cart
              </button>
              <button
                onClick={clearWishlist}
                className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors font-medium text-sm"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Wishlist Items */}
        {items.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-xl">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Your wishlist is empty
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Save items you love by clicking the heart icon on any product.
            </p>
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
            >
              Start Shopping
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-card border border-border rounded-lg overflow-hidden group"
              >
                {/* Product Image */}
                <Link href={`/shop/product/${item.slug}`}>
                  <div className="relative aspect-square bg-muted">
                    {item.image ? (
                      <Image
                        src={item.image.url}
                        alt={item.image.altText || item.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        No Image
                      </div>
                    )}
                    {!item.inStock && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="bg-foreground text-background px-3 py-1 text-sm font-medium rounded">
                          Out of Stock
                        </span>
                      </div>
                    )}
                  </div>
                </Link>

                {/* Product Info */}
                <div className="p-4">
                  <Link href={`/shop/product/${item.slug}`}>
                    <h3 className="font-medium text-foreground line-clamp-2 hover:text-primary transition-colors mb-2">
                      {item.name}
                    </h3>
                  </Link>

                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg font-bold text-foreground">
                      {formatPrice(item.price)}
                    </span>
                    {item.regularPrice && item.regularPrice > item.price && (
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(item.regularPrice)}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAddToCart(item)}
                      disabled={!item.inStock}
                      className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add to Cart
                    </button>
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      aria-label="Remove from wishlist"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            ))}
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
