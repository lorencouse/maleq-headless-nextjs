import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const test = searchParams.get('test');
  const results: Record<string, string> = {};

  // Test specific page code paths
  if (test === 'brand') {
    try {
      const { getBrandBySlug, getBrands, getHierarchicalCategories, getGlobalAttributes, getFilteredProducts } = await import('@/lib/products/combined-service');
      const { stripHtml } = await import('@/lib/utils/text-utils');
      const { sortProductsByPriority } = await import('@/lib/utils/product-sort');

      results['1_imports'] = 'OK';

      const brand = await getBrandBySlug('adam-eve');
      results['2_brandBySlug'] = brand ? `OK: ${brand.name} (${brand.count} products)` : 'NULL (not found)';

      const [brands, categories, attrs] = await Promise.all([
        getBrands(),
        getHierarchicalCategories(),
        getGlobalAttributes(),
      ]);
      results['3_brands'] = `OK (${brands.length})`;
      results['4_categories'] = `OK (${categories.length})`;
      results['5_attrs'] = `OK (colors: ${attrs.colors.length}, materials: ${attrs.materials.length})`;

      if (brand) {
        const productsResult = await getFilteredProducts({ limit: 2, brand: 'adam-eve' });
        results['6_filteredProducts'] = `OK (${productsResult.products.length} products)`;
        const sorted = sortProductsByPriority(productsResult.products);
        results['7_sorted'] = `OK (${sorted.length} products)`;
      }
    } catch (e: unknown) {
      results['error'] = e instanceof Error ? (e.stack || e.message) : String(e);
    }
    return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (test === 'category') {
    try {
      const { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } = await import('@/lib/products/combined-service');
      const { sortProductsByPriority } = await import('@/lib/utils/product-sort');
      const { findCategoryBySlug, flattenCategories, findParentCategory } = await import('@/lib/utils/category-helpers');

      results['1_imports'] = 'OK';

      const allCategories = await getHierarchicalCategories();
      results['2_categories'] = `OK (${allCategories.length} top-level)`;

      const category = findCategoryBySlug(allCategories, 'anal-toys');
      results['3_findCategory'] = category ? `OK: ${category.name} (${category.count} products)` : 'NULL (not found)';

      if (category) {
        const parentCategory = findParentCategory(allCategories, 'anal-toys');
        results['4_parentCategory'] = parentCategory ? `OK: ${parentCategory.name}` : 'NULL (no parent)';

        const [brandsData, attrsData] = await Promise.all([
          getBrands(),
          getGlobalAttributes(),
        ]);
        results['5_brandsAndAttrs'] = `OK (brands: ${brandsData.length}, colors: ${attrsData.colors.length})`;

        const productsResult = await getAllProducts({ category: 'anal-toys', limit: 2 });
        results['6_products'] = `OK (${productsResult.products.length} products)`;

        const saleResult = await getFilteredProducts({ limit: 2, category: 'anal-toys', onSale: true, inStock: true });
        results['7_saleProducts'] = `OK (${saleResult.products.length} products)`;
      }
    } catch (e: unknown) {
      results['error'] = e instanceof Error ? (e.stack || e.message) : String(e);
    }
    return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Default: run all basic tests
  try {
    const { getClient } = await import('@/lib/apollo/client');
    const { data } = await getClient().query({
      query: '{ posts(first: 1) { nodes { title } } }',
      variables: {},
    });
    results['graphql'] = 'OK';
  } catch (e: unknown) {
    results['graphql'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { stripHtml } = await import('@/lib/utils/text-utils');
    results['stripHtml'] = stripHtml('<p>test</p>') === 'test' ? 'OK' : 'UNEXPECTED';
  } catch (e: unknown) {
    results['stripHtml'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { getBlogPosts } = await import('@/lib/blog/blog-service');
    const posts = await getBlogPosts({ first: 1 });
    results['blogService'] = `OK (${posts.posts.length})`;
  } catch (e: unknown) {
    results['blogService'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const { getFilteredProducts } = await import('@/lib/products/combined-service');
    const result = await getFilteredProducts({ limit: 1 });
    results['combinedService'] = `OK (${result.products.length})`;
  } catch (e: unknown) {
    results['combinedService'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  results['env'] = process.env.NEXT_PUBLIC_WORDPRESS_API_URL || 'NOT SET';

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
}
