'use client';

import { useState } from 'react';
import VariationSelector from './VariationSelector';
import { EnhancedProduct } from '@/lib/products/product-service';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';

interface ProductPageClientProps {
  product: EnhancedProduct;
}

interface SelectedVariation {
  id: string;
  name: string;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  attributes: Array<{ name: string; value: string }>;
}

export default function ProductPageClient({ product }: ProductPageClientProps) {
  const isVariable = product.type === 'VARIABLE';
  const addItem = useCartStore((state) => state.addItem);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  const [selectedVariation, setSelectedVariation] = useState<SelectedVariation | null>(
    isVariable && product.variations && product.variations.length > 0
      ? product.variations[0]
      : null
  );

  const formatPrice = (price: string | null | undefined) => {
    if (!price) return 'N/A';
    // WPGraphQL returns prices already formatted (e.g., "$82.35")
    // If it starts with $, return as-is; otherwise format it
    if (price.startsWith('$')) return price;
    const num = parseFloat(price.replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 'N/A' : `$${num.toFixed(2)}`;
  };

  // Use selected variation data if available, otherwise use parent product data
  const displayPrice = selectedVariation?.price || product.price || product.regularPrice;
  const displayStockStatus = selectedVariation?.stockStatus || product.stockStatus;
  const displayStockQuantity = selectedVariation?.stockQuantity ?? product.stockQuantity;
  const displaySku = product.sku;

  // Helper to convert price string to number
  const priceToNumber = (price: string | null | undefined): number => {
    if (!price) return 0;
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Add to Cart Handler
  const handleAddToCart = async () => {
    // Validate stock
    if (displayStockStatus === 'OUT_OF_STOCK') {
      showError('This product is out of stock');
      return;
    }

    // For variable products, ensure variation is selected
    if (isVariable && !selectedVariation) {
      showError('Please select product options');
      return;
    }

    // Validate quantity
    if (quantity < 1) {
      showError('Quantity must be at least 1');
      return;
    }

    if (displayStockQuantity && quantity > displayStockQuantity) {
      showError(`Only ${displayStockQuantity} available in stock`);
      return;
    }

    setIsAdding(true);

    try {
      // Prepare cart item data
      const currentPrice = priceToNumber(displayPrice);
      const regularPrice = priceToNumber(
        selectedVariation?.regularPrice || product.regularPrice
      );

      addItem({
        productId: product.databaseId?.toString() || product.id,
        variationId: selectedVariation?.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku || '',
        price: currentPrice,
        regularPrice: regularPrice,
        quantity: quantity,
        image: product.image || undefined,
        attributes: selectedVariation?.attributes?.reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {} as Record<string, string>),
        stockQuantity: displayStockQuantity || undefined,
        maxQuantity: displayStockQuantity || 999,
        inStock: displayStockStatus === 'IN_STOCK',
        type: product.type,
      });

      showSuccess(`${product.name} added to cart!`);

      // Reset quantity after adding
      setQuantity(1);
    } catch (error) {
      console.error('Error adding to cart:', error);
      showError('Failed to add product to cart');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      {/* Price Section */}
      <div className="mb-6">
        {product.onSale && product.regularPrice && !selectedVariation ? (
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-red-600">
              {formatPrice(product.salePrice)}
            </span>
            <span className="text-xl text-gray-500 line-through">
              {formatPrice(product.regularPrice)}
            </span>
            <span className="px-3 py-1 bg-red-100 text-red-600 text-sm font-semibold rounded-full">
              SALE
            </span>
          </div>
        ) : (
          <span className="text-3xl font-bold text-gray-900">
            {formatPrice(displayPrice)}
          </span>
        )}
      </div>

      {/* Stock Status */}
      <div className="mb-6 flex items-center gap-3">
        {displayStockStatus === 'IN_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <p className="text-green-600 font-medium">In Stock</p>
          </div>
        ) : displayStockStatus === 'LOW_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <p className="text-yellow-600 font-medium">Low Stock</p>
          </div>
        ) : displayStockStatus === 'OUT_OF_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <p className="text-red-600 font-medium">Out of Stock</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
            <p className="text-orange-600 font-medium">On Backorder</p>
          </div>
        )}
        {displayStockQuantity && displayStockQuantity > 0 && (
          <p className="text-sm text-gray-600">
            ({displayStockQuantity} available)
          </p>
        )}
      </div>

      {/* Short Description */}
      {product.shortDescription && (
        <div className="mb-8 text-gray-700 leading-relaxed">
          {product.shortDescription.replace(/<[^>]*>/g, '')}
        </div>
      )}

      {/* Variation Selector */}
      {isVariable && product.variations && product.variations.length > 0 && (
        <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Options</h3>
          <VariationSelector
            variations={product.variations.map(v => ({
              ...v,
              sku: product.sku || '',
              stockQuantity: v.stockQuantity || 0,
            }))}
            onVariationChange={(variation) => setSelectedVariation({
              ...variation,
              regularPrice: variation.regularPrice || null,
              salePrice: variation.salePrice || null,
            } as SelectedVariation)}
          />
        </div>
      )}

      {/* Product Attributes */}
      {product.attributes && product.attributes.length > 0 && (
        <div className="mb-8 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">Product Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {product.attributes.filter(attr => attr.visible).map((attr, index) => (
              <div key={index}>
                <span className="text-gray-600">{attr.name}:</span>
                <span className="ml-2 font-medium">{attr.options.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add to Cart */}
      <div className="mb-8">
        <div className="flex gap-4 mb-4">
          <input
            type="number"
            min="1"
            max={displayStockQuantity || 99}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            className="w-24 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            onClick={handleAddToCart}
            disabled={displayStockStatus === 'OUT_OF_STOCK' || isAdding}
            className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
          >
            {isAdding ? 'Adding...' : displayStockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
        <button className="w-full border-2 border-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-50 transition-colors font-semibold">
          Add to Wishlist
        </button>
      </div>

      {/* Quick Info */}
      <div className="border-t border-gray-200 pt-6 space-y-3 text-sm">
        {displaySku && (
          <div className="flex justify-between">
            <span className="text-gray-600">SKU:</span>
            <span className="font-medium text-gray-900">{displaySku}</span>
          </div>
        )}
        {product.averageRating && product.averageRating > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-600">Rating:</span>
            <span className="font-medium text-gray-900">{product.averageRating} / 5</span>
          </div>
        )}
        {product.reviewCount && product.reviewCount > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-600">Reviews:</span>
            <span className="font-medium text-gray-900">{product.reviewCount}</span>
          </div>
        )}
      </div>
    </>
  );
}
