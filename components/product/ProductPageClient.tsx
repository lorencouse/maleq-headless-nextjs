'use client';

import { useState, useEffect, useMemo } from 'react';
import VariationSelector from './VariationSelector';
import ProductAddons, { SelectedAddon } from './ProductAddons';
import { EnhancedProduct } from '@/lib/products/product-service';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import WishlistButton from '@/components/wishlist/WishlistButton';
import StockAlertButton from '@/components/product/StockAlertButton';
import SocialShare from '@/components/product/SocialShare';
import TrustBadges from '@/components/product/TrustBadges';
import SatisfactionGuarantee from '@/components/product/SatisfactionGuarantee';
import StockStatusBadge from '@/components/ui/StockStatusBadge';
import {
  formatAttributeName,
  formatAttributeValue,
  formatPrice,
  parsePrice,
} from '@/lib/utils/woocommerce-format';
import { VariationImage, SelectedVariation } from '@/lib/types/product';
import { isAddonEligibleBySlug } from '@/lib/config/product-addons';

interface ProductPageClientProps {
  product: EnhancedProduct;
  onVariationImageChange?: (image: VariationImage | null) => void;
}

export default function ProductPageClient({
  product,
  onVariationImageChange,
}: ProductPageClientProps) {
  const isVariable = product.type === 'VARIABLE';
  const addItem = useCartStore((state) => state.addItem);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([]);

  // Check if product is eligible for addons based on its categories
  const isAddonEligible = useMemo(() => {
    const categorySlugs = product.categories?.map((cat) => cat.slug) || [];
    return isAddonEligibleBySlug(categorySlugs);
  }, [product.categories]);

  // Calculate total price including addons
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);

  // Get initial variation - prefer first in-stock variation
  const getInitialVariation = (): SelectedVariation | null => {
    if (!isVariable || !product.variations || product.variations.length === 0) {
      return null;
    }

    // Find first in-stock variation
    const inStockVariation = product.variations.find(
      v => v.stockStatus === 'IN_STOCK'
    );

    return inStockVariation || product.variations[0];
  };

  const [selectedVariation, setSelectedVariation] =
    useState<SelectedVariation | null>(getInitialVariation);

  // Use selected variation data if available, otherwise use parent product data
  const displayPrice =
    selectedVariation?.price || product.price || product.regularPrice;
  const displayStockStatus =
    selectedVariation?.stockStatus || product.stockStatus;
  const displayStockQuantity =
    selectedVariation?.stockQuantity ?? product.stockQuantity;
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
        selectedVariation?.regularPrice || product.regularPrice,
      );

      // Add main product to cart
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
        attributes: selectedVariation?.attributes?.reduce(
          (acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          },
          {} as Record<string, string>,
        ),
        stockQuantity: displayStockQuantity || undefined,
        maxQuantity: displayStockQuantity || 999,
        inStock: displayStockStatus === 'IN_STOCK',
        type: product.type,
      });

      // Add selected addons as separate cart items with real product data
      // Use addon.id as productId for unique cart identification (until real WooCommerce IDs are added)
      const wpBaseUrl = (process.env.NEXT_PUBLIC_WORDPRESS_API_URL || '').replace('/graphql', '');

      for (const addon of selectedAddons) {
        const cartProductId = addon.productId && addon.productId !== '0'
          ? addon.productId
          : addon.id; // Fallback to unique addon ID

        // Build full image URL from relative path
        const imageUrl = addon.image
          ? (addon.image.startsWith('http') ? addon.image : `${wpBaseUrl}${addon.image}`)
          : undefined;

        addItem({
          productId: cartProductId,
          name: `Add-on: ${addon.name}`,
          slug: addon.slug,
          sku: addon.sku,
          price: addon.price,
          regularPrice: addon.regularPrice,
          quantity: 1,
          image: imageUrl ? { url: imageUrl, altText: addon.name } : undefined,
          maxQuantity: 99,
          inStock: true,
          type: 'SIMPLE',
        });
      }

      // Build success message
      const addonCount = selectedAddons.length;
      const successMessage = addonCount > 0
        ? `${product.name} + ${addonCount} add-on${addonCount > 1 ? 's' : ''} added to cart!`
        : `${product.name} added to cart!`;

      showSuccess(successMessage);

      // Clear addon selections after adding
      setSelectedAddons([]);

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
      <div className='mb-6'>
        {product.onSale && product.regularPrice && !selectedVariation ? (
          <div className='flex items-baseline gap-3'>
            <span className='text-3xl font-bold text-primary'>
              {formatPrice(product.salePrice)}
            </span>
            <span className='text-xl text-muted-foreground line-through'>
              {formatPrice(product.regularPrice)}
            </span>
            <span className='px-3 py-1 bg-primary/10 text-primary text-sm font-semibold rounded-full'>
              SALE
            </span>
          </div>
        ) : (
          <span className='text-3xl font-bold text-foreground'>
            {formatPrice(displayPrice)}
          </span>
        )}
      </div>

      {/* Stock Status */}
      <div className='mb-6'>
        <StockStatusBadge
          status={displayStockStatus || 'OUT_OF_STOCK'}
          quantity={displayStockQuantity}
          showQuantity={true}
          size='lg'
        />
      </div>

      {/* Short Description */}
      {product.shortDescription && (
        <div className='mb-8 text-foreground/80 leading-relaxed'>
          {product.shortDescription.replace(/<[^>]*>/g, '')}
        </div>
      )}

      {/* Variation Selector */}
      {isVariable && product.variations && product.variations.length > 0 && (
        <div className='mb-8 p-6 bg-input rounded-xl border border-border'>
          <h3 className='text-lg font-semibold text-foreground mb-4'>
            Select Options
          </h3>
          <VariationSelector
            variations={product.variations.map((v) => ({
              ...v,
              sku: v.sku || '',
              stockQuantity: v.stockQuantity || 0,
            }))}
            productId={product.databaseId}
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
        <div className='mb-8 p-5 bg-primary/5 rounded-xl border border-primary/10'>
          <h3 className='font-semibold text-foreground mb-3'>
            Product Details
          </h3>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            {product.attributes
              .filter((attr) => attr.visible)
              .map((attr, index) => (
                <div key={index}>
                  <span className='text-muted-foreground'>
                    {formatAttributeName(attr.name)}:
                  </span>
                  <span className='ml-2 font-medium text-foreground'>
                    {attr.options
                      .map((opt) => formatAttributeValue(opt))
                      .join(', ')}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Product Addons - Show for eligible categories */}
      {isAddonEligible && displayStockStatus !== 'OUT_OF_STOCK' && (
        <ProductAddons onAddonsChange={setSelectedAddons} />
      )}

      {/* Add to Cart */}
      <div className='mb-8'>
        {displayStockStatus === 'OUT_OF_STOCK' ? (
          <>
            <StockAlertButton
              productId={product.databaseId?.toString() || product.id}
              productName={product.name}
              variant='button'
              className='mb-4'
            />
            <WishlistButton
              productId={product.databaseId?.toString() || product.id}
              name={product.name}
              slug={product.slug}
              price={parsePrice(displayPrice)}
              regularPrice={parsePrice(product.regularPrice)}
              image={product.image || undefined}
              inStock={false}
              variant='button'
            />
          </>
        ) : (
          <>
            {/* Total with addons display */}
            {addonsTotal > 0 && (
              <div className='mb-4 p-3 bg-primary/5 rounded-lg border border-primary/10'>
                <div className='flex justify-between items-center text-sm'>
                  <span className='text-muted-foreground'>Product:</span>
                  <span className='text-foreground'>{formatPrice(displayPrice)}</span>
                </div>
                <div className='flex justify-between items-center text-sm'>
                  <span className='text-muted-foreground'>Add-ons:</span>
                  <span className='text-foreground'>+${addonsTotal.toFixed(2)}</span>
                </div>
                <div className='flex justify-between items-center text-sm font-semibold mt-2 pt-2 border-t border-border'>
                  <span className='text-foreground'>Total:</span>
                  <span className='text-primary'>
                    ${(parsePrice(displayPrice) + addonsTotal).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className='flex gap-4 mb-4'>
              <input
                type='number'
                min='1'
                max={displayStockQuantity || 99}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className='w-24 px-4 py-3.5 border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors'
              />
              <button
                onClick={handleAddToCart}
                disabled={isAdding}
                className='flex-1 bg-primary text-primary-foreground py-3.5 px-6 rounded-xl hover:bg-primary-hover transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-semibold text-lg'
              >
                {isAdding ? 'Adding...' : addonsTotal > 0 ? 'Add All to Cart' : 'Add to Cart'}
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
              variant='button'
            />
          </>
        )}
      </div>

      {/* Trust Badges */}
      <div className='mb-6'>
        <TrustBadges variant='default' />
      </div>

      {/* Satisfaction Guarantee */}
      <div className='mb-8'>
        <SatisfactionGuarantee variant='compact' />
      </div>

      {/* Quick Info */}
      <div className='border-t border-border pt-6 space-y-3 text-sm'>
        {displaySku && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>SKU:</span>
            <span className='font-medium text-foreground'>{displaySku}</span>
          </div>
        )}
        {/* Debug: Product/Variation IDs */}
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>Product ID:</span>
          <span className='font-medium text-foreground'>
            {product.databaseId}
          </span>
        </div>
        {selectedVariation && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Variation ID:</span>
            <span className='font-medium text-foreground'>
              {selectedVariation.id}
            </span>
          </div>
        )}
        {product.averageRating && product.averageRating > 0 && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Rating:</span>
            <span className='font-medium text-foreground'>
              {product.averageRating} / 5
            </span>
          </div>
        )}
        {product.reviewCount && product.reviewCount > 0 && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Reviews:</span>
            <span className='font-medium text-foreground'>
              {product.reviewCount}
            </span>
          </div>
        )}
      </div>

      {/* Social Share */}
      <div className='border-t border-border pt-6 mt-6'>
        <SocialShare
          url={`/product/${product.slug}`}
          title={product.name}
          description={product.shortDescription?.replace(/<[^>]*>/g, '') || ''}
          image={product.image?.url}
          variant='icons'
        />
      </div>
    </>
  );
}
