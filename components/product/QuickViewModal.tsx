'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { UnifiedProduct } from '@/lib/products/combined-service';
import { useCartStore } from '@/lib/store/cart-store';
import { showAddedToCart, showError } from '@/lib/utils/toast';
import { formatPrice, parsePrice, calculatePercentOff } from '@/lib/utils/woocommerce-format';
import WishlistButton from '@/components/wishlist/WishlistButton';
import StockStatusBadge from '@/components/ui/StockStatusBadge';
import { stripHtml } from '@/lib/utils/text-utils';

interface QuickViewModalProps {
  product: UnifiedProduct;
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickViewModal({ product, isOpen, onClose }: QuickViewModalProps) {
  const addItem = useCartStore((state) => state.addItem);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const isVariable = product.type === 'VARIABLE';
  const displayStockStatus = product.stockStatus;

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleAddToCart = async () => {
    if (displayStockStatus === 'OUT_OF_STOCK') {
      showError('This product is out of stock');
      return;
    }

    if (isVariable) {
      // Redirect to product page for variable products
      onClose();
      window.location.href = `/product/${product.slug}`;
      return;
    }

    setIsAdding(true);

    try {
      addItem({
        productId: product.databaseId?.toString() || product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku || '',
        price: parsePrice(product.price || product.regularPrice),
        regularPrice: parsePrice(product.regularPrice),
        quantity: quantity,
        image: product.image || undefined,
        stockQuantity: product.stockQuantity || undefined,
        maxQuantity: product.stockQuantity || 999,
        inStock: displayStockStatus === 'IN_STOCK',
        type: product.type,
      });

      showAddedToCart(product.name);
      setQuantity(1);
    } catch (error) {
      console.error('Error adding to cart:', error);
      showError('Failed to add product to cart');
    } finally {
      setIsAdding(false);
    }
  };

  // Build gallery
  const gallery = [
    product.image,
    ...(product.galleryImages || []),
  ].filter(Boolean);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative bg-background rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-background/80 hover:bg-muted transition-colors"
            aria-label="Close quick view"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
            {/* Image Section */}
            <div className="space-y-4">
              {/* Main Image */}
              <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
                {gallery[selectedImageIndex] ? (
                  <Image
                    src={gallery[selectedImageIndex]!.url}
                    alt={gallery[selectedImageIndex]!.altText || product.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No Image
                  </div>
                )}

                {/* Sale Badge */}
                {product.onSale && (
                  <div className="absolute top-3 left-3 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded">
                    {(() => {
                      const percentOff = calculatePercentOff(product.regularPrice, product.salePrice);
                      return percentOff ? `${percentOff}% OFF` : 'SALE';
                    })()}
                  </div>
                )}
              </div>

              {/* Thumbnail Gallery */}
              {gallery.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {gallery.map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedImageIndex(index)}
                      className={`relative w-14 h-14 sm:w-16 sm:h-16 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                        selectedImageIndex === index
                          ? 'border-primary'
                          : 'border-transparent hover:border-muted-foreground/30'
                      }`}
                    >
                      {img && (
                        <Image
                          src={img.url}
                          alt={img.altText || `${product.name} - ${index + 1}`}
                          fill
                          className="object-cover"
                          sizes="64px"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info Section */}
            <div className="flex flex-col">
              {/* Category */}
              {product.categories?.[0] && (
                <a
                  href={`/product-category/${product.categories[0].slug}`}
                  className="text-sm link-animated mb-2 inline-block"
                  onClick={onClose}
                >
                  {product.categories[0].name}
                </a>
              )}

              {/* Name */}
              <h2 className="text-2xl font-bold text-foreground mb-4">{product.name}</h2>

              {/* Price */}
              <div className="mb-4">
                {product.onSale && product.regularPrice ? (
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold text-primary">
                      {formatPrice(product.salePrice)}
                    </span>
                    <span className="text-lg text-muted-foreground line-through">
                      {formatPrice(product.regularPrice)}
                    </span>
                  </div>
                ) : (
                  <span className="text-2xl font-bold text-foreground">
                    {formatPrice(product.price || product.regularPrice)}
                  </span>
                )}
              </div>

              {/* Stock Status */}
              <div className="mb-4">
                <StockStatusBadge
                  status={displayStockStatus || 'OUT_OF_STOCK'}
                  size="sm"
                />
              </div>

              {/* Short Description */}
              {product.shortDescription && (
                <p className="text-muted-foreground mb-6 line-clamp-3">
                  {stripHtml(product.shortDescription)}
                </p>
              )}

              {/* Variable Product Notice */}
              {isVariable && (
                <div className="mb-4 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                  This product has multiple options. View full details to select options.
                </div>
              )}

              {/* Quantity and Add to Cart */}
              {!isVariable && displayStockStatus !== 'OUT_OF_STOCK' && (
                <div className="flex gap-2 sm:gap-3 mb-4">
                  <div className="flex items-center border border-input rounded-lg">
                    <button
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="px-4 py-3 sm:px-3 sm:py-2 text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label="Decrease quantity"
                    >
                      <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                      </svg>
                    </button>
                    <span className="px-3 sm:px-4 py-3 sm:py-2 text-foreground font-medium min-w-[44px] text-center">
                      {quantity}
                    </span>
                    <button
                      onClick={() => setQuantity((q) => q + 1)}
                      className="px-4 py-3 sm:px-3 sm:py-2 text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label="Increase quantity"
                    >
                      <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                  <button
                    onClick={handleAddToCart}
                    disabled={isAdding}
                    className="flex-1 py-3 sm:py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50"
                  >
                    {isAdding ? 'Adding...' : 'Add to Cart'}
                  </button>
                </div>
              )}

              {/* Variable Product - Go to Product Page */}
              {isVariable && (
                <Link
                  href={`/product/${product.slug}`}
                  onClick={onClose}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold text-center mb-4"
                >
                  Select Options
                </Link>
              )}

              {/* Out of Stock - View Details */}
              {displayStockStatus === 'OUT_OF_STOCK' && (
                <Link
                  href={`/product/${product.slug}`}
                  onClick={onClose}
                  className="w-full py-3 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors font-semibold text-center mb-4"
                >
                  View Details
                </Link>
              )}

              {/* Wishlist and View Details */}
              <div className="flex gap-3">
                <WishlistButton
                  productId={product.databaseId?.toString() || product.id}
                  name={product.name}
                  slug={product.slug}
                  price={parsePrice(product.price || product.regularPrice)}
                  regularPrice={parsePrice(product.regularPrice)}
                  image={product.image || undefined}
                  inStock={displayStockStatus === 'IN_STOCK'}
                  variant="button"
                  className="flex-1"
                />
              </div>

              {/* View Full Details Link */}
              <Link
                href={`/product/${product.slug}`}
                onClick={onClose}
                className="mt-4 text-center text-sm link-animated inline-block mx-auto"
              >
                View Full Product Details
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
