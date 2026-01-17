import ProductCard from '@/components/shop/ProductCard';
import { getAllProducts, getProductCategories } from '@/lib/products/combined-service';

export const revalidate = 3600; // Revalidate every hour for stock updates

export default async function ShopPage() {
  // Get products from WooCommerce
  const { products } = await getAllProducts({ limit: 12 });
  const categories = await getProductCategories();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Shop</h1>
        <p className="text-lg text-gray-600">
          Browse our collection of quality products
        </p>
      </div>

      {/* Filters */}
      <div className="mb-8 flex flex-wrap gap-4">
        <select className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600">
          <option value="">All Categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <select className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600">
          <option>Sort by: Latest</option>
          <option>Price: Low to High</option>
          <option>Price: High to Low</option>
          <option>Most Popular</option>
        </select>
        <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg">
          <input type="checkbox" className="rounded" />
          <span>In Stock Only</span>
        </label>
      </div>

      {/* Products Grid */}
      {products.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600">No products found.</p>
        </div>
      )}

      {/* Pagination - To be implemented with client-side filtering */}
      {products.length >= 12 && (
        <div className="mt-12 text-center">
          <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Load More Products
          </button>
        </div>
      )}
    </div>
  );
}
