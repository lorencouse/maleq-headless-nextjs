'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { UnifiedProduct } from '@/lib/products/combined-service';
import QuickAddButton from './QuickAddButton';
import WishlistButton from '@/components/wishlist/WishlistButton';
import QuickViewModal from '@/components/product/QuickViewModal';
import {
  formatPrice,
  parsePrice,
  calculatePercentOff,
} from '@/lib/utils/woocommerce-format';

interface ProductCardProps {
  product: UnifiedProduct;
  /** When true, shows a delete button instead of wishlist button (for wishlist page) */
  isWishlist?: boolean;
  /** Callback when remove button is clicked (for wishlist page) */
  onRemove?: (productId: string) => void;
}

export default function ProductCard({
  product,
  isWishlist,
  onRemove,
}: ProductCardProps) {
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Get first category
  const primaryCategory = product.categories?.[0];
  const isVariable = product.type === 'VARIABLE';

  return (
    <div className='bg-card border border-border rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all group h-full flex flex-col'>
      {/* Product Image - Link wrapper */}
      <Link
        href={`/product/${product.slug}`}
        className='product-card-link block'
      >
        <div className='relative h-44 sm:h-56 lg:h-64 w-full overflow-hidden bg-background'>
          {product.image ? (
            <Image
              src={product.image.url}
              alt={product.image.altText || product.name}
              fill
              className='object-contain group-hover:scale-105 transition-transform duration-300'
              sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
            />
          ) : (
            <div className='flex items-center justify-center h-full text-muted-foreground'>
              No Image
            </div>
          )}

          {/* Sale Badge */}
          {product.onSale && (
            <div className='absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded'>
              {(() => {
                const percentOff = calculatePercentOff(
                  product.regularPrice,
                  product.salePrice,
                );
                return percentOff ? `${percentOff}% OFF` : 'SALE';
              })()}
            </div>
          )}

          {/* Stock Status Badge */}
          {product.stockStatus === 'OUT_OF_STOCK' && (
            <div className='absolute top-2 left-2 bg-foreground text-background text-xs font-bold px-2 py-1 rounded'>
              OUT OF STOCK
            </div>
          )}
        </div>
      </Link>

      {/* Content section - grows to push footer down */}
      <Link
        href={`/product/${product.slug}`}
        className='product-card-link flex-1 flex flex-col p-4'
      >
        {/* Product Name */}
        <div className='relative pb-2 mb-2'>
          <h3 className='heading-plain text-lg font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors'>
            {product.name}
          </h3>
          {/* Red underline (always visible) */}
          <span className='absolute bottom-0 left-0 w-full h-0.5 bg-primary' />
          {/* Black underline (expands on hover) */}
          <span className='absolute bottom-0 left-0 w-0 h-0.5 bg-black transition-all duration-300 group-hover:w-full' />
        </div>

        {/* Spacer to push price and info to bottom */}
        <div className='flex-1' />

        {/* Stock Status */}
        {product.stockStatus === 'LOW_STOCK' && product.stockQuantity && (
          <div className='mb-2 text-xs text-warning'>
            Only {product.stockQuantity} left in stock
          </div>
        )}

        {/* Variation Count */}
        {isVariable && product.variations && product.variations.length > 0 && (
          <div className='mb-2 text-xs text-primary font-medium'>
            {product.variations.length}{' '}
            {product.variations.length === 1 ? 'option' : 'options'} available
          </div>
        )}

        {/* Price - at bottom of content section */}
        <div className='flex items-center gap-2'>
          {product.onSale && product.regularPrice ? (
            <>
              <span className='text-lg font-bold text-primary'>
                {formatPrice(product.salePrice)}
              </span>
              <span className='text-sm text-muted-foreground line-through'>
                {formatPrice(product.regularPrice)}
              </span>
            </>
          ) : (
            <span className='text-lg font-bold text-foreground'>
              {formatPrice(product.price || product.regularPrice)}
            </span>
          )}
        </div>
      </Link>

      {/* Add to Cart Button + Actions - Fixed at bottom */}
      <div className='p-4 pt-0 mt-auto'>
        <div className='flex gap-2'>
          <div className='flex-1'>
            <QuickAddButton product={product} />
          </div>
          {/* Quick Actions - Always visible */}
          <div className='flex gap-2'>
            {/* Quick View Button */}
            <button
              onClick={() => setIsQuickViewOpen(true)}
              className='p-2 rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
              aria-label='Quick view'
            >
              <svg
                className='w-5 h-5'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M15 12a3 3 0 11-6 0 3 3 0 016 0z'
                />
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'
                />
              </svg>
            </button>

            {/* Wishlist/Remove Button */}
            {isWishlist && onRemove ? (
              <button
                onClick={() =>
                  onRemove(product.databaseId?.toString() || product.id)
                }
                className='p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors'
                aria-label='Remove from wishlist'
              >
                <svg
                  className='w-5 h-5'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                  />
                </svg>
              </button>
            ) : (
              <WishlistButton
                productId={product.databaseId?.toString() || product.id}
                name={product.name}
                slug={product.slug}
                price={parsePrice(product.price)}
                regularPrice={parsePrice(product.regularPrice)}
                image={product.image || undefined}
                inStock={product.stockStatus === 'IN_STOCK'}
                variant='icon'
                className='border border-border rounded-lg'
              />
            )}
          </div>
        </div>
      </div>

      {/* Quick View Modal */}
      <QuickViewModal
        product={product}
        isOpen={isQuickViewOpen}
        onClose={() => setIsQuickViewOpen(false)}
      />
    </div>
  );
}
