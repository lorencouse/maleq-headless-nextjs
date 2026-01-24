'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import { parsePrice } from '@/lib/utils/woocommerce-format';
import { UnifiedProduct } from '@/lib/products/combined-service';

interface QuickAddButtonProps {
  product: UnifiedProduct;
}

export default function QuickAddButton({ product }: QuickAddButtonProps) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const [isAdding, setIsAdding] = useState(false);

  const isVariable = product.type === 'VARIABLE';
  const isOutOfStock = product.stockStatus === 'OUT_OF_STOCK';

  const handleClick = async () => {
    // For variable products, navigate to product page
    if (isVariable) {
      router.push(`/product/${product.slug}`);
      return;
    }

    // Don't add if out of stock
    if (isOutOfStock) {
      return;
    }

    setIsAdding(true);

    try {
      const currentPrice = parsePrice(product.salePrice || product.price || product.regularPrice);
      const regularPrice = parsePrice(product.regularPrice);

      addItem({
        productId: product.databaseId?.toString() || product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku || '',
        price: currentPrice,
        regularPrice: regularPrice || currentPrice,
        quantity: 1,
        image: product.image || undefined,
        stockQuantity: product.stockQuantity || undefined,
        maxQuantity: product.stockQuantity || 999,
        inStock: product.stockStatus === 'IN_STOCK' || product.stockStatus === 'LOW_STOCK',
        type: product.type,
      });

      showSuccess(`${product.name} added to cart!`);
    } catch (error) {
      console.error('Error adding to cart:', error);
      showError('Failed to add to cart');
    } finally {
      setIsAdding(false);
    }
  };

  const getButtonText = () => {
    if (isOutOfStock) return 'Out of Stock';
    if (isVariable) return 'Select Options';
    if (isAdding) return 'Adding...';
    return 'Add to Cart';
  };

  return (
    <button
      onClick={handleClick}
      disabled={isOutOfStock || isAdding}
      className="w-full bg-primary text-primary-foreground py-2 px-4 rounded-md hover:bg-primary-hover transition-colors disabled:bg-muted disabled:cursor-not-allowed"
    >
      {getButtonText()}
    </button>
  );
}
