import Link from 'next/link';
import ProductCarousel from '@/components/product/ProductCarousel';
import type { UnifiedProduct } from '@/lib/products/combined-service';
import type { RelatedProductCategory } from '@/lib/db/post-relations';

interface RecommendedProductsProps {
  products: UnifiedProduct[];
  categories: RelatedProductCategory[];
}

/**
 * Editor-curated "Recommended Products" block for a guide, driven by the
 * post ⇄ product relations meta box (independent of inline shortcodes).
 * Renders nothing when a post has no relations.
 */
export default function RecommendedProducts({
  products,
  categories,
}: RecommendedProductsProps) {
  if (products.length === 0 && categories.length === 0) {
    return null;
  }

  return (
    <section className='border-t border-border pt-8 mt-12'>
      {products.length > 0 && (
        <ProductCarousel
          products={products}
          title='Recommended Products'
          subtitle='Hand-picked for this guide'
        />
      )}

      {categories.length > 0 && (
        <div className='mt-6'>
          <h3 className='text-sm font-semibold text-foreground mb-3'>
            Browse related categories
          </h3>
          <div className='flex flex-wrap items-center gap-2'>
            {categories.map((cat) => (
              <Link
                key={cat.termId}
                href={`/shop?category=${cat.slug}`}
                className='inline-flex items-center px-3 py-1 bg-input text-foreground text-sm rounded-full hover:bg-border transition-colors leading-none'
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
