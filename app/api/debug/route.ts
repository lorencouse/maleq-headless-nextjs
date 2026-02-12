import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, string> = {};

  // Test 1: GraphQL client
  try {
    const { getClient } = await import('@/lib/apollo/client');
    results['1_graphqlClient'] = 'import OK';
    const client = getClient();
    results['1_graphqlClientInstance'] = client ? 'created OK' : 'NULL';
  } catch (e: unknown) {
    results['1_graphqlClient'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 2: Basic GraphQL query
  try {
    const { getClient } = await import('@/lib/apollo/client');
    const { data } = await getClient().query({
      query: '{ posts(first: 1) { nodes { title } } }',
      variables: {},
    });
    results['2_graphqlQuery'] = `OK: ${JSON.stringify(data).slice(0, 200)}`;
  } catch (e: unknown) {
    results['2_graphqlQuery'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 3: Blog service import
  try {
    const { getBlogPosts } = await import('@/lib/blog/blog-service');
    results['3_blogServiceImport'] = 'OK';
  } catch (e: unknown) {
    results['3_blogServiceImport'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 4: Blog service query
  try {
    const { getBlogPosts } = await import('@/lib/blog/blog-service');
    const posts = await getBlogPosts({ first: 1 });
    results['4_blogPosts'] = `OK (${posts.posts.length} posts)`;
  } catch (e: unknown) {
    results['4_blogPosts'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 5: isomorphic-dompurify / text-utils
  try {
    const { stripHtml } = await import('@/lib/utils/text-utils');
    results['5_textUtilsImport'] = 'OK';
    const result = stripHtml('<p>Hello <strong>World</strong></p>');
    results['5_stripHtml'] = `OK: "${result}"`;
  } catch (e: unknown) {
    results['5_textUtils'] = `FAIL: ${e instanceof Error ? e.stack || e.message : String(e)}`;
  }

  // Test 6: Product service
  try {
    const { getProductBySlug } = await import('@/lib/products/product-service');
    results['6_productServiceImport'] = 'OK';
  } catch (e: unknown) {
    results['6_productServiceImport'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 7: Combined service
  try {
    const { getFilteredProducts } = await import('@/lib/products/combined-service');
    results['7_combinedServiceImport'] = 'OK';
  } catch (e: unknown) {
    results['7_combinedServiceImport'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 8: Combined service query
  try {
    const { getFilteredProducts } = await import('@/lib/products/combined-service');
    const result = await getFilteredProducts({ limit: 1 });
    results['8_filteredProducts'] = `OK (${result.products.length} products)`;
  } catch (e: unknown) {
    results['8_filteredProducts'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 9: Hierarchical categories (used by sex-toys page)
  try {
    const { getHierarchicalCategories } = await import('@/lib/products/combined-service');
    const cats = await getHierarchicalCategories();
    results['9_categories'] = `OK (${cats.length} top-level categories)`;
  } catch (e: unknown) {
    results['9_categories'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 10: Category helpers
  try {
    const { findCategoryBySlug } = await import('@/lib/utils/category-helpers');
    results['10_categoryHelpers'] = 'import OK';
  } catch (e: unknown) {
    results['10_categoryHelpers'] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 11: Environment check
  results['11_env_WORDPRESS_API_URL'] = process.env.NEXT_PUBLIC_WORDPRESS_API_URL || 'NOT SET';
  results['11_env_NODE_ENV'] = process.env.NODE_ENV || 'NOT SET';

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
