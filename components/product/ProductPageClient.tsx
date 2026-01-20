'use client';

import { useState } from 'react';
import VariationSelector from './VariationSelector';
import { EnhancedProduct } from '@/lib/products/product-service';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import WishlistButton from '@/components/wishlist/WishlistButton';
import StockAlertButton from '@/components/product/StockAlertButton';
import SocialShare from '@/components/product/SocialShare';
import { formatAttributeName, formatAttributeValue, formatPrice, parsePrice } from '@/lib/utils/woocommerce-format';

interface VariationImage {
  url: string;
  altText: string;
}

interface ProductPageClientProps {
  product: EnhancedProduct;
  onVariationImageChange?: (image: VariationImage | null) => void;
}

interface SelectedVariation {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string;
  stockQuantity: number | null;
  attributes: Array<{ name: string; value: string }>;
  image?: VariationImage | null;
}

export default function ProductPageClient({ product, onVariationImageChange }: ProductPageClientProps) {
  const isVariable = product.type === 'VARIABLE';
  const addItem = useCartStore((state) => state.addItem);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  const [selectedVariation, setSelectedVariation] = useState<SelectedVariation | null>(
    isVariable && product.variations && product.variations.length > 0
      ? product.variations[0]
      : null
  );

  // Use selected variation data if available, otherwise use parent product data
  const displayPrice = selectedVariation?.price || product.price || product.regularPrice;
  const displayStockStatus = selectedVariation?.stockStatus || product.stockStatus;
  const displayStockQuantity = selectedVariation?.stockQuantity ?? product.stockQuantity;
  // For variable products, show variation SKU; for simple products, show product SKU
  const displaySku = isVariable ? selectedVariation?.sku : product.sku;

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
      const currentPrice = parsePrice(displayPrice);
      const regularPrice = parsePrice(
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
            <span className="text-3xl font-bold text-primary">
              {formatPrice(product.salePrice)}
            </span>
            <span className="text-xl text-muted-foreground line-through">
              {formatPrice(product.regularPrice)}
            </span>
            <span className="px-3 py-1 bg-primary/10 text-primary text-sm font-semibold rounded-full">
              SALE
            </span>
          </div>
        ) : (
          <span className="text-3xl font-bold text-foreground">
            {formatPrice(displayPrice)}
          </span>
        )}
      </div>

      {/* Stock Status */}
      <div className="mb-6 flex items-center gap-3">
        {displayStockStatus === 'IN_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-success rounded-full"></div>
            <p className="text-success font-medium">In Stock</p>
          </div>
        ) : displayStockStatus === 'LOW_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-warning rounded-full"></div>
            <p className="text-warning font-medium">Low Stock</p>
          </div>
        ) : displayStockStatus === 'OUT_OF_STOCK' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-destructive rounded-full"></div>
            <p className="text-destructive font-medium">Out of Stock</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-accent rounded-full"></div>
            <p className="text-accent font-medium">On Backorder</p>
          </div>
        )}
        {displayStockQuantity && displayStockQuantity > 0 && (
          <p className="text-sm text-muted-foreground">
            ({displayStockQuantity} available)
          </p>
        )}
      </div>

      {/* Short Description */}
      {product.shortDescription && (
        <div className="mb-8 text-foreground/80 leading-relaxed">
          {product.shortDescription.replace(/<[^>]*>/g, '')}
        </div>
      )}

      {/* Variation Selector */}
      {isVariable && product.variations && product.variations.length > 0 && (
        <div className="mb-8 p-6 bg-input rounded-xl border border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4">Select Options</h3>
          <VariationSelector
            variations={product.variations.map(v => ({
              ...v,
              sku: v.sku || '',
              stockQuantity: v.stockQuantity || 0,
            }))}
            onVariationChange={(variation) => {
              setSelectedVariation({
                ...variation,
                sku: variation.sku || null,
                regularPrice: variation.regularPrice || null,
                salePrice: variation.salePrice || null,
                image: variation.image || null,
              } as SelectedVariation);
              // Update the product image gallery
              if (onVariationImageChange) {
                onVariationImageChange(variation.image || null);
              }
            }}
          />
        </div>
      )}

      {/* Product Attributes */}
      {product.attributes && product.attributes.length > 0 && (
        <div className="mb-8 p-5 bg-primary/5 rounded-xl border border-primary/10">
          <h3 className="font-semibold text-foreground mb-3">Product Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {product.attributes.filter(attr => attr.visible).map((attr, index) => (
              <div key={index}>
                <span className="text-muted-foreground">{formatAttributeName(attr.name)}:</span>
                <span className="ml-2 font-medium text-foreground">
                  {attr.options.map(opt => formatAttributeValue(opt)).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add to Cart */}
      <div className="mb-8">
        {displayStockStatus === 'OUT_OF_STOCK' ? (
          <>
            <StockAlertButton
              productId={product.databaseId?.toString() || product.id}
              productName={product.name}
              variant="button"
              className="mb-4"
            />
            <WishlistButton
              productId={product.databaseId?.toString() || product.id}
              name={product.name}
              slug={product.slug}
              price={parsePrice(displayPrice)}
              regularPrice={parsePrice(product.regularPrice)}
              image={product.image || undefined}
              inStock={false}
              variant="button"
            />
          </>
        ) : (
          <>
            <div className="flex gap-4 mb-4">
              <input
                type="number"
                min="1"
                max={displayStockQuantity || 99}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-24 px-4 py-3.5 border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
              />
              <button
                onClick={handleAddToCart}
                disabled={isAdding}
                className="flex-1 bg-primary text-primary-foreground py-3.5 px-6 rounded-xl hover:bg-primary-hover transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-semibold text-lg"
              >
                {isAdding ? 'Adding...' : 'Add to Cart'}
              </button>
            </div>
            <WishlistButton
              productId={product.databaseId?.toString() || product.id}
              name={product.name}
              slug={product.slug}
              price={parsePrice(displayPrice)}
              regularPrice={parsePrice(product.regularPrice)}
              image={product.image || undefined}
              inStock={displayStockStatus === 'IN_STOCK'}
              variant="button"
            />
          </>
        )}
      </div>

      {/* Quick Info */}
      <div className="border-t border-border pt-6 space-y-3 text-sm">
        {displaySku && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">SKU:</span>
            <span className="font-medium text-foreground">{displaySku}</span>
          </div>
        )}
        {product.averageRating && product.averageRating > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rating:</span>
            <span className="font-medium text-foreground">{product.averageRating} / 5</span>
          </div>
        )}
        {product.reviewCount && product.reviewCount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reviews:</span>
            <span className="font-medium text-foreground">{product.reviewCount}</span>
          </div>
        )}
      </div>

      {/* Social Share */}
      <div className="border-t border-border pt-6 mt-6">
        <SocialShare
          url={`/shop/product/${product.slug}`}
          title={product.name}
          description={product.shortDescription?.replace(/<[^>]*>/g, '') || ''}
          image={product.image?.url}
          variant="icons"
        />
      </div>
    </>
  );
}
