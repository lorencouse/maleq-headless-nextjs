import { ProductSpecification } from '@/lib/products/product-service';

interface ProductSpecificationsProps {
  specifications: ProductSpecification[];
}

export default function ProductSpecifications({ specifications }: ProductSpecificationsProps) {
  if (!specifications || specifications.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-gray-200 pt-8 mt-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Product Specifications</h2>
      <div className="bg-gray-50 rounded-lg p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {specifications.map((spec, index) => (
            <div key={index} className="border-b border-gray-200 pb-3">
              <dt className="text-sm font-semibold text-gray-600 mb-1">
                {spec.label}
              </dt>
              <dd className="text-base text-gray-900">
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
