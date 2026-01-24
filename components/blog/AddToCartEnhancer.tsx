'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { useCartStore } from '@/lib/store/cart-store';
import { showSuccess, showError } from '@/lib/utils/toast';
import { getProductionImageUrl } from '@/lib/utils/image';

interface ProductPlaceholder {
  element: HTMLElement;
  productId: string;
}

interface ProductData {
  id: number;
  name: string;
  slug: string;
  sku: string;
  price: number;
  regularPrice: number;
  image: { url: string; altText: string } | null;
  inStock: boolean;
}

/**
 * Parse WooCommerce price strings (e.g., "$29.99") to numbers
 */
function parseWooPrice(price: string | number | null | undefined): number {
  if (price === null || price === undefined) return 0;
  if (typeof price === 'number') return price;
  const cleaned = price.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Custom Add to Cart component rendered in place of WooCommerce shortcodes
 */
function BlogAddToCart({ productId }: { productId: string }) {
  const [isAdding, setIsAdding] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [product, setProduct] = useState<ProductData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addItem = useCartStore((state) => state.addItem);

  // Fetch product data by ID on mount
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`/api/products/${productId}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to load product');
        }

        const data = await response.json();

        setProduct({
          id: data.id,
          name: data.name,
          slug: data.slug,
          sku: data.sku || '',
          price: parseWooPrice(data.salePrice || data.price),
          regularPrice: parseWooPrice(data.regularPrice) || parseWooPrice(data.price),
          image: data.image ? {
            url: getProductionImageUrl(data.image.url),
            altText: data.image.altText || data.name,
          } : null,
          inStock: data.inStock ?? true,
        });
      } catch (err) {
        console.error('Could not fetch product details:', err);
        setError(err instanceof Error ? err.message : 'Failed to load product');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  const handleAddToCart = () => {
    if (!product) return;

    setIsAdding(true);

    try {
      addItem({
        productId: product.id.toString(),
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        price: product.price,
        regularPrice: product.regularPrice,
        image: product.image || undefined,
        quantity: 1,
        inStock: product.inStock,
        maxQuantity: 99,
      });

      showSuccess('Added to cart!');
      setIsAdded(true);

      setTimeout(() => {
        setIsAdded(false);
      }, 2000);

    } catch (err) {
      console.error('Error adding to cart:', err);
      showError('Failed to add to cart');
    } finally {
      setIsAdding(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 max-w-sm mx-auto">
        <div className="w-[325px] h-[325px] bg-muted animate-pulse rounded-lg" />
        <div className="w-48 h-4 bg-muted animate-pulse rounded" />
        <div className="w-32 h-6 bg-muted animate-pulse rounded" />
        <div className="w-40 h-12 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  // Error state
  if (error || !product) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 max-w-sm mx-auto">
        <div className="w-[325px] h-[325px] bg-muted rounded-lg flex items-center justify-center">
          <span className="text-muted-foreground text-sm">Product unavailable</span>
        </div>
        <p className="text-sm text-muted-foreground">{error || 'Product not found'}</p>
      </div>
    );
  }

  const isOnSale = product.regularPrice > product.price;

  return (
    <div className="flex flex-col items-center gap-3 py-6 max-w-sm mx-auto">
      {/* Product Image with Caption */}
      <figure className="text-center">
        {product.image ? (
          <Link href={`/product/${product.slug}`} className="block">
            <div
              className="relative w-[325px] h-[325px] overflow-hidden hover:opacity-90 transition-opacity"
              style={{ borderRadius: '0.75rem 0.75rem 0 0' }}
            >
              <Image
                src={product.image.url}
                alt={product.image.altText}
                fill
                className="object-cover"
                style={{ borderRadius: '0.75rem 0.75rem 0 0' }}
                sizes="325px"
              />
            </div>
          </Link>
        ) : (
          <div
            className="w-[325px] h-[325px] bg-muted flex items-center justify-center"
            style={{ borderRadius: '0.75rem 0.75rem 0 0' }}
          >
            <span className="text-muted-foreground text-sm">No Image</span>
          </div>
        )}
        {/* Product Name as Caption */}
        <figcaption className="mt-0 py-2 px-3 text-sm bg-muted rounded-b-lg">
          <Link href={`/product/${product.slug}`}>
            {product.name}
          </Link>
        </figcaption>
      </figure>

      {/* Price Display */}
      <div className="flex items-center gap-3">
        {isOnSale ? (
          <>
            <span className="text-lg text-muted-foreground line-through">
              ${product.regularPrice.toFixed(2)}
            </span>
            <span className="text-2xl font-bold text-red-600">
              ${product.price.toFixed(2)}
            </span>
          </>
        ) : product.price > 0 ? (
          <span className="text-2xl font-bold text-foreground">
            ${product.price.toFixed(2)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Price not available</span>
        )}
      </div>

      {/* Add to Cart Button */}
      <button
        onClick={handleAddToCart}
        disabled={isAdding || !product.inStock}
        className={`
          inline-flex items-center justify-center gap-2
          px-6 py-3 rounded-lg font-semibold text-base
          transition-all duration-200 w-full
          ${isAdded
            ? 'bg-green-600 text-white'
            : 'bg-primary text-primary-foreground hover:bg-primary-hover hover:-translate-y-0.5'
          }
          disabled:opacity-50 disabled:cursor-not-allowed
          shadow-md hover:shadow-lg
        `}
      >
        {isAdding ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Adding...
          </>
        ) : isAdded ? (
          <>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Added to Cart!
          </>
        ) : !product.inStock ? (
          'Out of Stock'
        ) : (
          <>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Add to Cart
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Enhances WooCommerce add-to-cart shortcodes in blog content
 * Finds placeholder divs and renders custom React components
 */
export default function AddToCartEnhancer() {
  const [placeholders, setPlaceholders] = useState<ProductPlaceholder[]>([]);

  useEffect(() => {
    // Find all placeholder divs
    const elements = document.querySelectorAll('.blog-add-to-cart-placeholder');

    const found: ProductPlaceholder[] = [];
    elements.forEach((el) => {
      const element = el as HTMLElement;
      const productId = element.dataset.productId;

      if (productId) {
        found.push({ element, productId });
      }
    });

    setPlaceholders(found);
  }, []);

  return (
    <>
      {placeholders.map((placeholder, index) =>
        createPortal(
          <BlogAddToCart
            key={`${placeholder.productId}-${index}`}
            productId={placeholder.productId}
          />,
          placeholder.element
        )
      )}
    </>
  );
}
