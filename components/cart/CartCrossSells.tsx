'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import ProductCarousel from '@/components/product/ProductCarousel';
import { UnifiedProduct } from '@/lib/products/combined-service';

export default function CartCrossSells() {
  const items = useCartStore((state) => state.items);
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;

    const controller = new AbortController();
    setIsLoading(true);

    // Fetch popular in-stock products as recommendations
    fetch('/api/products?limit=12&inStock=true&sort=popularity', {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        const cartProductIds = new Set(items.map((item) => item.productId));
        // Filter out items already in cart
        const filtered = (data.products || []).filter(
          (p: UnifiedProduct) =>
            !cartProductIds.has(p.id) &&
            !cartProductIds.has(p.databaseId?.toString() || '')
        );
        setProducts(filtered.slice(0, 8));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch cross-sells:', err);
        }
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [items]);

  if (isLoading || products.length === 0) return null;

  return (
    <section className="mt-12">
      <ProductCarousel
        products={products}
        title="You Might Also Like"
        subtitle="Popular products other customers love"
        viewAllLink="/shop"
        viewAllText="Browse All"
        showGradients
        showMobileHint
      />
    </section>
  );
}
