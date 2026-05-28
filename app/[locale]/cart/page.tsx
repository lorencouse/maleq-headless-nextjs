'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useCartStore, useIsCartEmpty, useCartSubtotal } from '@/lib/store/cart-store';
import CartItem from '@/components/cart/CartItem';
import CartSummary from '@/components/cart/CartSummary';
import EmptyCart from '@/components/cart/EmptyCart';
import CartCrossSells from '@/components/cart/CartCrossSells';
import CartRecoveryHandler from '@/components/cart/CartRecoveryHandler';
import * as gtag from '@/lib/analytics/gtag';

export default function CartPage() {
  const t = useTranslations('cart');
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const isEmpty = useIsCartEmpty();
  const subtotal = useCartSubtotal();

  // Track view_cart event
  useEffect(() => {
    if (items.length > 0) {
      gtag.viewCart(
        items.map((item) => ({
          item_id: item.productId,
          item_name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
        subtotal,
      );
    }
  }, []);

  if (isEmpty) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <CartRecoveryHandler />
        <EmptyCart />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <CartRecoveryHandler />
      {/* Page Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('itemsInCart', { count: items.length })}
          </p>
        </div>
        <button
          onClick={() => {
            if (window.confirm(t('confirmClear'))) {
              clearCart();
            }
          }}
          className="px-4 py-2.5 min-h-[44px] text-sm text-muted-foreground hover:text-destructive hover:bg-muted rounded-lg transition-colors"
        >
          {t('clearCart')}
        </button>
      </div>

      {/* Cart Content */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-8">
        {/* Cart Items */}
        <div className="lg:col-span-7 xl:col-span-8">
          <div className="bg-card border border-border rounded-lg">
            <div className="px-6">
              {items.map((item) => (
                <CartItem key={item.id} item={item} />
              ))}
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-5 xl:col-span-4 mt-8 lg:mt-0">
          <CartSummary />
        </div>
      </div>

      {/* Cross-sells */}
      <CartCrossSells />
    </div>
  );
}
