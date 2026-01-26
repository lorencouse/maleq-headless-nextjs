'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AccountLayout from '@/components/account/AccountLayout';
import ProductCard from '@/components/shop/ProductCard';
import { useWishlistStore, WishlistItem } from '@/lib/store/wishlist-store';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import { UnifiedProduct } from '@/lib/products/combined-service';

/**
 * Convert a WishlistItem to UnifiedProduct format for ProductCard
 */
function wishlistItemToProduct(item: WishlistItem): UnifiedProduct {
  const priceString = `$${item.price.toFixed(2)}`;
  const regularPriceString = item.regularPrice ? `$${item.regularPrice.toFixed(2)}` : priceString;
  const isOnSale = item.regularPrice ? item.price < item.regularPrice : false;

  return {
    id: item.productId,
    databaseId: parseInt(item.productId) || 0,
    name: item.name,
    slug: item.slug,
    description: null,
    shortDescription: null,
    sku: null,
    price: priceString,
    regularPrice: regularPriceString,
    salePrice: isOnSale ? priceString : null,
    onSale: isOnSale,
    stockStatus: item.inStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
    stockQuantity: null,
    image: item.image || null,
    categories: [],
    type: 'SIMPLE',
  };
}

export default function WishlistPage() {
  const { items, removeItem, clearWishlist, hydrate } = useWishlistStore();
  const addToCart = useCartStore((state) => state.addItem);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrate();
    setMounted(true);
  }, [hydrate]);

  const handleRemove = (productId: string) => {
    removeItem(productId);
    showSuccess('Removed from wishlist');
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
              <ProductCard
                key={item.id}
                product={wishlistItemToProduct(item)}
                isWishlist
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
