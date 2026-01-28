'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/lib/store/cart-store';
import { showAddedToCart, showError } from '@/lib/utils/toast';
import { parsePrice } from '@/lib/utils/woocommerce-format';
import { CartImage } from '@/lib/types/cart';

export interface ProductForCart {
  id: string;
  databaseId?: number;
  name: string;
  slug: string;
  sku?: string | null;
  price?: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  stockStatus?: string;
  stockQuantity?: number | null;
  type?: string;
  image?: CartImage | null;
}

export interface VariationForCart {
  id: string;
  sku?: string | null;
  price?: string | null;
  regularPrice?: string | null;
  salePrice?: string | null;
  stockStatus?: string;
  stockQuantity?: number | null;
  attributes?: Array<{ name: string; value: string }>;
  image?: { url: string; altText: string } | null;
}

export interface UseAddToCartOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  redirectVariableProducts?: boolean;
}

export interface UseAddToCartReturn {
  isAdding: boolean;
  addToCart: (params: AddToCartParams) => Promise<boolean>;
  addSimpleProduct: (product: ProductForCart, quantity?: number) => Promise<boolean>;
  addVariableProduct: (
    product: ProductForCart,
    variation: VariationForCart,
    quantity?: number
  ) => Promise<boolean>;
}

interface AddToCartParams {
  product: ProductForCart;
  variation?: VariationForCart | null;
  quantity?: number;
}

export function useAddToCart(options: UseAddToCartOptions = {}): UseAddToCartReturn {
  const { onSuccess, onError, redirectVariableProducts = true } = options;

  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const [isAdding, setIsAdding] = useState(false);

  const getStockStatus = useCallback(
    (product: ProductForCart, variation?: VariationForCart | null): string => {
      return variation?.stockStatus || product.stockStatus || 'OUT_OF_STOCK';
    },
    []
  );

  const getStockQuantity = useCallback(
    (product: ProductForCart, variation?: VariationForCart | null): number | undefined => {
      const qty = variation?.stockQuantity ?? product.stockQuantity;
      return qty !== null ? qty ?? undefined : undefined;
    },
    []
  );

  const validateStock = useCallback(
    (
      product: ProductForCart,
      variation: VariationForCart | null | undefined,
      quantity: number
    ): { valid: boolean; error?: string } => {
      const stockStatus = getStockStatus(product, variation);
      const stockQuantity = getStockQuantity(product, variation);

      if (stockStatus === 'OUT_OF_STOCK') {
        return { valid: false, error: 'This product is out of stock' };
      }

      if (quantity < 1) {
        return { valid: false, error: 'Quantity must be at least 1' };
      }

      if (stockQuantity && quantity > stockQuantity) {
        return { valid: false, error: `Only ${stockQuantity} available in stock` };
      }

      return { valid: true };
    },
    [getStockStatus, getStockQuantity]
  );

  const addToCart = useCallback(
    async ({ product, variation, quantity = 1 }: AddToCartParams): Promise<boolean> => {
      const isVariable = product.type === 'VARIABLE';

      // For variable products without variation, redirect to product page
      if (isVariable && !variation && redirectVariableProducts) {
        router.push(`/product/${product.slug}`);
        return false;
      }

      // Validate stock
      const validation = validateStock(product, variation, quantity);
      if (!validation.valid) {
        showError(validation.error!);
        return false;
      }

      setIsAdding(true);

      try {
        // Determine price
        const priceSource = variation || product;
        const currentPrice = parsePrice(
          priceSource.salePrice || priceSource.price || priceSource.regularPrice
        );
        const regularPrice = parsePrice(priceSource.regularPrice || priceSource.price);

        const stockStatus = getStockStatus(product, variation);
        const stockQuantity = getStockQuantity(product, variation);

        // Build attributes from variation
        const attributes = variation?.attributes?.reduce(
          (acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          },
          {} as Record<string, string>
        );

        addItem({
          productId: product.databaseId?.toString() || product.id,
          variationId: variation?.id,
          name: product.name,
          slug: product.slug,
          sku: product.sku || '',
          price: currentPrice,
          regularPrice: regularPrice || currentPrice,
          quantity,
          image: variation?.image || product.image || undefined,
          attributes,
          stockQuantity,
          maxQuantity: stockQuantity || 999,
          inStock: stockStatus === 'IN_STOCK' || stockStatus === 'LOW_STOCK',
          type: product.type,
        });

        showAddedToCart(product.name);
        onSuccess?.();
        return true;
      } catch (error) {
        console.error('Error adding to cart:', error);
        showError('Failed to add product to cart');
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
        return false;
      } finally {
        setIsAdding(false);
      }
    },
    [
      addItem,
      router,
      redirectVariableProducts,
      validateStock,
      getStockStatus,
      getStockQuantity,
      onSuccess,
      onError,
    ]
  );

  const addSimpleProduct = useCallback(
    async (product: ProductForCart, quantity = 1): Promise<boolean> => {
      return addToCart({ product, quantity });
    },
    [addToCart]
  );

  const addVariableProduct = useCallback(
    async (
      product: ProductForCart,
      variation: VariationForCart,
      quantity = 1
    ): Promise<boolean> => {
      return addToCart({ product, variation, quantity });
    },
    [addToCart]
  );

  return {
    isAdding,
    addToCart,
    addSimpleProduct,
    addVariableProduct,
  };
}

export default useAddToCart;
