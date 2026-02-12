import { Suspense } from 'react';
import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import { findCategoryBySlug, flattenCategories, findParentCategory } from '@/lib/utils/category-helpers';
import ShopPageClient from '@/components/shop/ShopPageClient';
import CategoryHero from '@/components/shop/CategoryHero';
import SubcategoryGrid from '@/components/shop/SubcategoryGrid';
import FeaturedProducts from '@/components/shop/FeaturedProducts';
import ShopSearch from '@/components/shop/ShopSearch';

export const dynamic = 'force-dynamic';

interface TestPageProps {
  params: Promise<{ slug: string }>;
}

export default async function TestCategoryPage({ params }: TestPageProps) {
  const { slug } = await params;
  const results: Record<string, string> = {};

  try {
    results['1_slug'] = slug;

    const allCategories = await getHierarchicalCategories();
    results['2_categories'] = `${allCategories.length} top-level`;

    const category = findCategoryBySlug(allCategories, slug);
    results['3_category'] = category ? `${category.name} (${category.count})` : 'NOT FOUND';

    if (!category) {
      return (
        <pre>{JSON.stringify(results, null, 2)}</pre>
      );
    }

    const parentCategory = findParentCategory(allCategories, slug);
    results['4_parent'] = parentCategory ? parentCategory.name : 'none';

    const [brandsData, { colors, materials }] = await Promise.all([
      getBrands(),
      getGlobalAttributes(),
    ]);
    results['5_brands'] = `${brandsData.length}`;
    results['6_colors'] = `${colors.length}`;
    results['7_materials'] = `${materials.length}`;

    const [productsResult, saleProductsResult] = await Promise.all([
      getAllProducts({ category: slug, limit: 4 }),
      getFilteredProducts({ limit: 4, category: slug, onSale: true, inStock: true }),
    ]);

    const products = sortProductsByPriority(productsResult.products);
    const saleProducts = saleProductsResult.products;
    results['8_products'] = `${products.length}`;
    results['9_sale_products'] = `${saleProducts.length}`;

    const childCategories = category.children?.filter(c => c.count > 0) || [];
    results['10_children'] = `${childCategories.length}`;
    results['11_status'] = 'ALL DATA OK - RENDERING COMPONENTS';

    return (
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Debug Info */}
        <pre style={{ background: '#e0ffe0', padding: '1rem', marginBottom: '2rem', fontSize: '12px' }}>
          {JSON.stringify(results, null, 2)}
        </pre>

        {/* CategoryHero - Component Test 1 */}
        <div data-test="category-hero">
          <CategoryHero
            category={category}
            productCount={products.length}
            parentCategory={parentCategory}
          />
        </div>

        {/* SubcategoryGrid - Component Test 2 */}
        {childCategories.length > 0 && (
          <div data-test="subcategory-grid" id="subcategories">
            <SubcategoryGrid
              subcategories={childCategories}
              parentSlug={slug}
              parentName={category.name}
            />
          </div>
        )}

        {/* FeaturedProducts - Component Test 3 */}
        {saleProducts.length > 0 && (
          <div data-test="featured-products">
            <FeaturedProducts
              products={saleProducts}
              title={`${category.name} on Sale`}
              subtitle="Limited time deals in this category"
              viewAllHref={`/sex-toys/${slug}?onSale=true`}
              viewAllText="View All Deals"
            />
          </div>
        )}

        {/* All Products Header + ShopSearch - Component Test 4 */}
        <div id="products" className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-1">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
              All {category.name}
            </h2>
            <Suspense fallback={<div className="w-full max-w-md h-11 bg-muted rounded-lg animate-pulse" />}>
              <ShopSearch />
            </Suspense>
          </div>
        </div>

        {/* ShopPageClient - Component Test 5 */}
        {products.length > 0 && (
          <div data-test="shop-page-client">
            <Suspense fallback={<div>Loading ShopPageClient...</div>}>
              <ShopPageClient
                initialProducts={products}
                categories={allCategories}
                brands={brandsData}
                colors={colors}
                materials={materials}
                hasMore={productsResult.pageInfo.hasNextPage}
                initialCursor={productsResult.pageInfo.endCursor}
                initialCategory={slug}
              />
            </Suspense>
          </div>
        )}
      </div>
    );
  } catch (error) {
    results['ERROR'] = error instanceof Error ? error.stack || error.message : String(error);
    return (
      <div>
        <h1>Test Category Page ERROR</h1>
        <pre style={{ whiteSpace: 'pre-wrap', color: 'red' }}>{JSON.stringify(results, null, 2)}</pre>
      </div>
    );
  }
}
