import Image from 'next/image';
import Link from 'next/link';
import { getHierarchicalCategories, HierarchicalCategory } from '@/lib/products/combined-service';
import { getCategoryImage, getCategoryConfig } from '@/lib/config/category-icons';

// Flatten all categories including nested children
function flattenCategories(categories: HierarchicalCategory[]): HierarchicalCategory[] {
  const result: HierarchicalCategory[] = [];

  function traverse(cats: HierarchicalCategory[], depth = 0) {
    for (const cat of cats) {
      result.push({ ...cat, children: [] }); // Add without children to avoid duplication
      if (cat.children && cat.children.length > 0) {
        traverse(cat.children, depth + 1);
      }
    }
  }

  traverse(categories);
  return result;
}

export default async function TestCategoriesPage() {
  const categories = await getHierarchicalCategories();
  const allCategories = flattenCategories(categories);

  // Separate categories with and without images
  const withImages = allCategories.filter(cat => getCategoryImage(cat.slug));
  const withoutImages = allCategories.filter(cat => !getCategoryImage(cat.slug));

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Category Image Test Page</h1>
      <p className="text-muted-foreground mb-8">
        Total: {allCategories.length} categories |
        With images: {withImages.length} |
        Without images: {withoutImages.length}
      </p>

      {/* Categories WITH images */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4 text-green-600">
          Categories with Images ({withImages.length})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {withImages.map((category) => {
            const imagePath = getCategoryImage(category.slug);

            return (
              <Link
                key={category.id}
                href={`/product-category/${category.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="relative overflow-hidden rounded-lg border border-green-500/30 bg-card hover:border-green-500 transition-colors"
              >
                <div className="aspect-square relative">
                  {imagePath && (
                    <Image
                      src={imagePath}
                      alt={category.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                    />
                  )}
                  {/* Centered bar overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full bg-black/60 backdrop-blur-sm py-2 px-2 text-center">
                      <p className="text-white font-semibold text-xs leading-tight line-clamp-2">
                        {category.name}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-2 text-xs">
                  <p className="text-muted-foreground truncate" title={category.slug}>
                    {category.slug}
                  </p>
                  <p className="text-muted-foreground">
                    {category.count} items
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Categories WITHOUT images */}
      <section>
        <h2 className="text-2xl font-bold mb-4 text-orange-600">
          Categories without Images ({withoutImages.length})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {withoutImages.map((category) => {
            const config = getCategoryConfig(category.slug);

            return (
              <Link
                key={category.id}
                href={`/product-category/${category.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="relative overflow-hidden rounded-lg border border-orange-500/30 bg-card hover:border-orange-500 transition-colors"
              >
                <div className="aspect-square relative">
                  {/* Gradient fallback */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient}`} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3">
                    <div className="w-8 h-8 text-white/80 mb-2">
                      {config.icon}
                    </div>
                    <p className="text-white font-semibold text-xs text-center leading-tight line-clamp-2">
                      {category.name}
                    </p>
                  </div>
                </div>
                <div className="p-2 text-xs">
                  <p className="text-muted-foreground truncate" title={category.slug}>
                    {category.slug}
                  </p>
                  <p className="text-muted-foreground">
                    {category.count} items
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Image file list for reference */}
      <section className="mt-12 p-4 bg-muted rounded-lg">
        <h2 className="text-xl font-bold mb-4">Missing Image Slugs (for reference)</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Add these to <code className="bg-background px-1 rounded">lib/config/category-icons.tsx</code> categoryImages mapping:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs font-mono">
          {withoutImages.map((cat) => (
            <div key={cat.id} className="bg-background p-2 rounded truncate" title={cat.slug}>
              '{cat.slug}'
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8">
        <Link href="/shop" className="text-primary hover:underline">
          &larr; Back to Shop
        </Link>
      </div>
    </div>
  );
}
