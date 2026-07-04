'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import VariationSelector from './VariationSelector';
import ProductAddons, { SelectedAddon } from './ProductAddons';
import type { EnhancedProduct } from '@/lib/products/product-service';
import { findDefaultVariation } from '@/lib/products/variation-utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useMiniCartControls } from '@/lib/store/ui-store';
import { showAddedToCart, showError } from '@/lib/utils/toast';
import QuantitySelector from '@/components/ui/QuantitySelector';
import WishlistButton from '@/components/wishlist/WishlistButton';
import StockAlertButton from '@/components/product/StockAlertButton';
import SocialShare from '@/components/product/SocialShare';
import TrustBadges from '@/components/product/TrustBadges';
import SatisfactionGuarantee from '@/components/product/SatisfactionGuarantee';
import StockStatusBadge from '@/components/ui/StockStatusBadge';
import { useLocalizedCategoryName } from '@/lib/i18n/category-translations';
import {
  useLocalizedColorName,
  useLocalizedMaterialName,
  useLocalizedFlavorName,
  useLocalizedAttributeName,
} from '@/lib/i18n/attribute-translations';
import DiscountTierBanner from '@/components/ui/DiscountTierBanner';
import {
  formatAttributeName,
  formatAttributeValue,
  formatPrice,
  parsePrice,
  calculatePercentOff,
} from '@/lib/utils/woocommerce-format';
import { VariationImage, SelectedVariation } from '@/lib/types/product';
import { isAddonEligibleBySlug } from '@/lib/config/product-addons';
import { stripHtml } from '@/lib/utils/text-utils';
import * as gtag from '@/lib/analytics/gtag';

interface ProductPageClientProps {
  product: EnhancedProduct;
  onVariationImageChange?: (image: VariationImage | null) => void;
  primaryCategory?: { name: string; slug: string } | null;
  externalSelectedVariationId?: string | null;
}

export default function ProductPageClient({
  product,
  onVariationImageChange,
  primaryCategory,
  externalSelectedVariationId,
}: ProductPageClientProps) {
  const isVariable = product.type === 'VARIABLE';
  const router = useRouter();
  const t = useTranslations('productPage');
  const tProduct = useTranslations('product');
  const tCart = useTranslations('cart');
  const localizeCategoryName = useLocalizedCategoryName();
  const localizeColorName = useLocalizedColorName();
  const localizeMaterialName = useLocalizedMaterialName();
  const localizeFlavorName = useLocalizedFlavorName();
  const localizeAttributeName = useLocalizedAttributeName();
  const addItem = useCartStore((state) => state.addItem);
  const miniCartControls = useMiniCartControls();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([]);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const addToCartRef = useRef<HTMLDivElement>(null);

  // Show sticky bar when main add-to-cart button scrolls out of view
  useEffect(() => {
    const el = addToCartRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Track product view
  useEffect(() => {
    gtag.viewItem({
      item_id: product.databaseId?.toString() || product.id,
      item_name: product.name,
      price: parsePrice(product.price || product.regularPrice),
      item_category: primaryCategory?.name,
      item_brand: product.brands?.[0]?.name,
    });
  }, [product.id]);

  // Check if product is eligible for addons based on its categories
  const isAddonEligible = useMemo(() => {
    const categorySlugs = product.categories?.map((cat) => cat.slug) || [];
    return isAddonEligibleBySlug(categorySlugs);
  }, [product.categories]);

  // Calculate total price including addons
  const addonsTotal = selectedAddons.reduce(
    (sum, addon) => sum + addon.price,
    0,
  );

  // Get initial variation using shared default logic
  const getInitialVariation = (): SelectedVariation | null => {
    if (!isVariable || !product.variations || product.variations.length === 0) {
      return null;
    }
    return findDefaultVariation(product.variations, product.defaultAttributes) || null;
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
      showError(t('toastOutOfStock'));
      return;
    }

    // For variable products, ensure variation is selected
    if (isVariable && !selectedVariation) {
      showError(t('toastSelectOptions'));
      return;
    }

    // Validate quantity
    if (quantity < 1) {
      showError(t('toastMinQuantity'));
      return;
    }

    if (displayStockQuantity && quantity > displayStockQuantity) {
      showError(t('toastOnlyAvailable', { count: displayStockQuantity }));
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
        variationId: selectedVariation?.databaseId?.toString(),
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
      const wpBaseUrl = (
        process.env.NEXT_PUBLIC_WORDPRESS_API_URL || ''
      ).replace('/graphql', '');

      for (const addon of selectedAddons) {
        const cartProductId =
          addon.productId && addon.productId !== '0'
            ? addon.productId
            : addon.id; // Fallback to unique addon ID

        // Build full image URL from relative path
        const imageUrl = addon.image
          ? addon.image.startsWith('http')
            ? addon.image
            : `${wpBaseUrl}${addon.image}`
          : undefined;

        addItem({
          productId: cartProductId,
          name: t('cartAddonPrefix', { name: addon.name }),
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
      const successMessage =
        addonCount > 0
          ? t('toastAddedWithAddons', { name: product.name, count: addonCount })
          : t('toastAddedSimple', { name: product.name });

      // Track add to cart
      gtag.addToCart({
        item_id: product.databaseId?.toString() || product.id,
        item_name: product.name,
        price: currentPrice,
        quantity: quantity,
        item_category: primaryCategory?.name,
        item_variant: selectedVariation?.attributes?.map(a => a.value).join(' / '),
      });

      showAddedToCart(successMessage, tCart('viewCart'));

      // Show "View Cart" button for 5 seconds
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 5000);

      // Clear addon selections after adding
      setSelectedAddons([]);

      // Reset quantity after adding
      setQuantity(1);
    } catch (error) {
      console.error('Error adding to cart:', error);
      showError(t('toastAddFailed'));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      {/* Price Section */}
      <div className='my-6'>
        {selectedVariation &&
        selectedVariation.salePrice &&
        selectedVariation.regularPrice &&
        selectedVariation.salePrice !== selectedVariation.regularPrice ? (
          <div className='flex items-baseline gap-3'>
            <span className='text-3xl font-bold text-primary'>
              {formatPrice(selectedVariation.salePrice)}
            </span>
            <span className='text-xl text-muted-foreground line-through'>
              {formatPrice(selectedVariation.regularPrice)}
            </span>
            <span className='px-3 py-1 bg-primary/10 text-primary text-sm font-semibold rounded-full'>
              {(() => {
                const percentOff = calculatePercentOff(
                  selectedVariation.regularPrice,
                  selectedVariation.salePrice,
                );
                return percentOff
                  ? tProduct('saleBadge', { percent: percentOff })
                  : tProduct('saleBadgeFallback');
              })()}
            </span>
          </div>
        ) : product.onSale && product.regularPrice && !selectedVariation ? (
          <div className='flex items-baseline gap-3'>
            <span className='text-3xl font-bold text-primary'>
              {formatPrice(product.salePrice)}
            </span>
            <span className='text-xl text-muted-foreground line-through'>
              {formatPrice(product.regularPrice)}
            </span>
            <span className='px-3 py-1 bg-primary/10 text-primary text-sm font-semibold rounded-full'>
              {(() => {
                const percentOff = calculatePercentOff(
                  product.regularPrice,
                  product.salePrice,
                );
                return percentOff
                  ? tProduct('saleBadge', { percent: percentOff })
                  : tProduct('saleBadgeFallback');
              })()}
            </span>
          </div>
        ) : (
          <span className='text-3xl font-bold text-foreground'>
            {formatPrice(displayPrice)}
          </span>
        )}
      </div>

      {/* Stock Status & Category */}
      <div className='mb-6 flex items-center justify-between'>
        <StockStatusBadge
          status={displayStockStatus || 'OUT_OF_STOCK'}
          quantity={displayStockQuantity}
          showQuantity={true}
          size='lg'
        />
        {primaryCategory && (
          <a
            href={`/sex-toys/${primaryCategory.slug}`}
            className='link-subtle text-sm'
          >
            {localizeCategoryName(primaryCategory.slug, primaryCategory.name)}
          </a>
        )}
      </div>

      {/* Discount Tiers */}
      <DiscountTierBanner variant='compact' className='mb-4' />

      {/* Short Description */}
      {product.shortDescription &&
        (() => {
          const fullText = stripHtml(product.shortDescription);
          const truncateLength = 150;
          const shouldTruncate = fullText.length > truncateLength;
          const displayText =
            shouldTruncate && !isDescriptionExpanded
              ? fullText.slice(0, truncateLength).trim() + '...'
              : fullText;

          return (
            <div className='mb-8 text-foreground/80 leading-relaxed'>
              <span>{displayText}</span>
              {shouldTruncate && (
                <button
                  onClick={() =>
                    setIsDescriptionExpanded(!isDescriptionExpanded)
                  }
                  className='ml-1 text-primary hover:text-primary-hover font-medium transition-colors'
                >
                  {isDescriptionExpanded ? t('readLess') : t('readMore')}
                </button>
              )}
            </div>
          );
        })()}

      {/* Product Video */}
      {product.videoUrl && (
        <div className="mb-8">
          <video
            src={product.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="none"
            className="w-full rounded-lg"
            aria-label={t('videoAria', { name: product.name })}
          />
        </div>
      )}

      {/* Variation Selector */}
      {isVariable && product.variations && product.variations.length > 0 && (
        <div className='mb-8 p-6 bg-input rounded-xl border border-border'>
          <h3 className='text-lg font-semibold text-foreground mb-4'>
            {t('selectOptionsHeading')}
          </h3>
          <VariationSelector
            productName={product.name}
            variations={product.variations.map((v) => ({
              ...v,
              sku: v.sku || '',
              stockQuantity: v.stockQuantity ?? 0,
            }))}
            externalSelectedVariationId={externalSelectedVariationId}
            defaultAttributes={product.defaultAttributes}
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

      {/* Product Attributes — only attrs that have a value to show; variation
          axes often surface here with empty options (e.g. bare "Style:") */}
      {product.attributes &&
        product.attributes.some(
          (attr) => attr.visible && attr.options.some((o) => o && o.trim())
        ) && (
        <div className='mb-8 p-5 bg-primary/5 rounded-xl border border-primary/10'>
          <h3 className='font-semibold text-foreground mb-3'>
            {t('productDetailsHeading')}
          </h3>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            {product.attributes
              .filter((attr) => attr.visible && attr.options.some((o) => o && o.trim()))
              .map((attr, index) => {
                // Localize the value for color/material attributes via the
                // dictionaries (keyed by the slugified option); other attribute
                // values (size, style, flavor, variant…) stay as-is.
                const an = attr.name.toLowerCase().replace(/^pa_/, '');
                const localizeValue = (opt: string) => {
                  const slug = opt.toLowerCase().replace(/\s+/g, '-');
                  const formatted = formatAttributeValue(opt);
                  if (an === 'color') return localizeColorName(slug, formatted);
                  if (an === 'material') return localizeMaterialName(slug, formatted);
                  if (an === 'flavor') return localizeFlavorName(slug, formatted);
                  return formatted;
                };
                return (
                  <div key={index}>
                    <span className='text-muted-foreground'>
                      {localizeAttributeName(attr.name, formatAttributeName(attr.name))}:
                    </span>
                    <span className='ml-2 font-medium text-foreground'>
                      {attr.options.map(localizeValue).join(', ')}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Product Addons - Show for eligible categories */}
      {isAddonEligible && displayStockStatus !== 'OUT_OF_STOCK' && (
        <ProductAddons onAddonsChange={setSelectedAddons} />
      )}

      {/* Add to Cart */}
      <div className='mb-8' ref={addToCartRef}>
        {displayStockStatus === 'OUT_OF_STOCK' ? (
          <>
            <StockAlertButton
              productId={product.databaseId?.toString() || product.id}
              productName={product.name}
              productSlug={product.slug}
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
                  <span className='text-muted-foreground'>{t('productTotalLabel')}</span>
                  <span className='text-foreground'>
                    {formatPrice(displayPrice)}
                  </span>
                </div>
                <div className='flex justify-between items-center text-sm'>
                  <span className='text-muted-foreground'>{t('addonsTotalLabel')}</span>
                  <span className='text-foreground'>
                    +${addonsTotal.toFixed(2)}
                  </span>
                </div>
                <div className='flex justify-between items-center text-sm font-semibold mt-2 pt-2 border-t border-border'>
                  <span className='text-foreground'>{t('totalLabel')}</span>
                  <span className='text-primary'>
                    ${(parsePrice(displayPrice) + addonsTotal).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className='flex gap-4 mb-4 items-center'>
              <QuantitySelector
                quantity={quantity}
                min={1}
                max={displayStockQuantity || 99}
                size='md'
                onQuantityChange={setQuantity}
                showInput
              />
              {justAdded ? (
                <button
                  onClick={() => miniCartControls.open()}
                  className='flex-1 bg-success text-success-foreground py-3.5 px-6 rounded-xl hover:opacity-90 transition-colors font-semibold text-lg flex items-center justify-center gap-2'
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t('viewCart')}
                </button>
              ) : (
                <button
                  onClick={handleAddToCart}
                  disabled={isAdding}
                  className='flex-1 bg-primary text-primary-foreground py-3.5 px-6 rounded-xl hover:bg-primary-hover transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-semibold text-lg'
                >
                  {isAdding
                    ? t('adding')
                    : addonsTotal > 0
                      ? t('addAllToCart')
                      : t('addToCart')}
                </button>
              )}
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
      <div className='mb-6'>
        <SatisfactionGuarantee variant='compact' />
      </div>

      {/* Discount Tiers - moved above short description */}

      {/* Quick Info */}
      <div className='border-t border-border pt-6 space-y-3 text-sm'>
        {displaySku && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('skuLabel')}</span>
            <span className='font-medium text-foreground'>{displaySku}</span>
          </div>
        )}
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>
            {isVariable ? t('parentIdLabel') : t('productIdLabel')}
          </span>
          <span className='font-medium text-foreground'>
            {product.databaseId}
          </span>
        </div>
        {(product.averageRating ?? 0) > 0 && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('ratingLabel')}</span>
            <span className='font-medium text-foreground'>
              {t('ratingValue', { value: product.averageRating ?? 0 })}
            </span>
          </div>
        )}
        {(product.reviewCount ?? 0) > 0 && (
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('reviewsLabel')}</span>
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
          description={stripHtml(product.shortDescription || '')}
          image={product.image?.url}
          variant='icons'
        />
      </div>

      {/* Sticky Add to Cart Bar - portaled to body to avoid parent transform issues */}
      {showStickyBar && displayStockStatus !== 'OUT_OF_STOCK' && createPortal(
        <div className='fixed bottom-0 left-0 right-0 z-30 w-screen bg-background/95 backdrop-blur-sm border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.1)]'>
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 sm:py-3'>
            {/* Mobile: stacked layout / Desktop: single row */}
            <div className='flex items-center justify-between gap-2 mb-1.5 sm:mb-0 sm:hidden'>
              <p className='font-semibold text-foreground text-sm truncate'>{product.name}</p>
              <p className='text-primary font-bold text-sm flex-shrink-0'>{formatPrice(displayPrice)}</p>
            </div>
            <div className='flex items-center gap-3 sm:gap-4'>
              <div className='hidden sm:block min-w-0 flex-1'>
                <p className='font-semibold text-foreground text-base truncate'>{product.name}</p>
                <p className='text-primary font-bold text-lg'>{formatPrice(displayPrice)}</p>
              </div>
              <div className='flex-shrink-0'>
                <QuantitySelector
                  quantity={quantity}
                  min={1}
                  max={displayStockQuantity || 99}
                  size='sm'
                  onQuantityChange={setQuantity}
                />
              </div>
              {justAdded ? (
                <button
                  onClick={() => miniCartControls.open()}
                  className='flex-1 sm:flex-none bg-success text-success-foreground py-2.5 px-6 rounded-lg hover:opacity-90 transition-colors font-semibold text-sm sm:text-base whitespace-nowrap flex items-center justify-center gap-2'
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t('viewCart')}
                </button>
              ) : (
                <button
                  onClick={handleAddToCart}
                  disabled={isAdding}
                  className='flex-1 sm:flex-none bg-primary text-primary-foreground py-2.5 px-6 rounded-lg hover:bg-primary-hover transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-semibold text-sm sm:text-base whitespace-nowrap'
                >
                  {isAdding ? t('adding') : t('addToCart')}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
