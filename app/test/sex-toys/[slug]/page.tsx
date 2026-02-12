import { getAllProducts, getHierarchicalCategories, getBrands, getGlobalAttributes, getFilteredProducts } from '@/lib/products/combined-service';
import { sortProductsByPriority } from '@/lib/utils/product-sort';
import { findCategoryBySlug, flattenCategories, findParentCategory } from '@/lib/utils/category-helpers';

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

    const productsResult = await getAllProducts({ category: slug, limit: 2 });
    results['8_products'] = `${productsResult.products.length}`;

    const sorted = sortProductsByPriority(productsResult.products);
    results['9_sorted'] = `${sorted.length}`;

    const childCategories = category.children?.filter(c => c.count > 0) || [];
    results['10_children'] = `${childCategories.length}`;

    return (
      <div>
        <h1>Test Category Page: {category.name}</h1>
        <pre>{JSON.stringify(results, null, 2)}</pre>
        <h2>Products:</h2>
        <ul>
          {sorted.map(p => (
            <li key={p.id}>{p.name} - {p.price}</li>
          ))}
        </ul>
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
