'use client';

import { useState } from 'react';
import VariationSelector from './VariationSelector';
import { EnhancedProduct } from '@/lib/products/product-service';

interface ProductPageClientProps {
  product: EnhancedProduct;
}

interface SelectedVariation {
  id: string;
  sku: string;
  name: string;
  price: string | null;
  stockStatus: string;
  stockQuantity: number;
  attributes: Array<{ name: string; value: string }>;
}

export default function ProductPageClient({ product }: ProductPageClientProps) {
  const [selectedVariation, setSelectedVariation] = useState<SelectedVariation | null>(
    product.isVariableProduct && product.variations && product.variations.length > 0
      ? product.variations[0]
      : null
  );

  const formatPrice = (price: string | null | undefined) => {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  // Use selected variation data if available, otherwise use parent product data
  const displayPrice = selectedVariation?.price || product.price || product.regularPrice;
  const displayStockStatus = selectedVariation?.stockStatus || product.stockStatus;
  const displayStockQuantity = selectedVariation?.stockQuantity ?? product.stockQuantity;
  const displaySku = selectedVariation?.sku || product.sku;

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
      {product.isVariableProduct && product.variations && product.variations.length > 0 && (
        <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Options</h3>
          <VariationSelector
            variations={product.variations}
            onVariationChange={setSelectedVariation}
          />
        </div>
      )}

      {/* Key Features (from dimensions) */}
      {product.dimensions && Object.values(product.dimensions).some(v => v) && (
        <div className="mb-8 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">Quick Specs</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {product.dimensions.length && (
              <div>
                <span className="text-gray-600">Length:</span>
                <span className="ml-2 font-medium">{product.dimensions.length}"</span>
              </div>
            )}
            {product.dimensions.width && (
              <div>
                <span className="text-gray-600">Width:</span>
                <span className="ml-2 font-medium">{product.dimensions.width}"</span>
              </div>
            )}
            {product.dimensions.height && (
              <div>
                <span className="text-gray-600">Height:</span>
                <span className="ml-2 font-medium">{product.dimensions.height}"</span>
              </div>
            )}
            {product.dimensions.weight && (
              <div>
                <span className="text-gray-600">Weight:</span>
                <span className="ml-2 font-medium">{product.dimensions.weight} lbs</span>
              </div>
            )}
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
            defaultValue="1"
            className="w-24 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
            disabled={displayStockStatus === 'OUT_OF_STOCK'}
          >
            {displayStockStatus === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Add to Cart'}
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
        {product.upcCode && (
          <div className="flex justify-between">
            <span className="text-gray-600">UPC:</span>
            <span className="font-medium text-gray-900">{product.upcCode}</span>
          </div>
        )}
        {product.releaseDate && (
          <div className="flex justify-between">
            <span className="text-gray-600">Release Date:</span>
            <span className="font-medium text-gray-900">
              {new Date(product.releaseDate).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
