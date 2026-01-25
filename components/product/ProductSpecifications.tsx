import Link from 'next/link';
import { ProductSpecification } from '@/lib/products/product-service';

interface ProductSpecificationsProps {
  specifications: ProductSpecification[];
}

export default function ProductSpecifications({
  specifications,
}: ProductSpecificationsProps) {
  if (!specifications || specifications.length === 0) {
    return null;
  }

  return (
    <div className='border-t border-border pt-8 mt-8'>
      <h2 className='text-2xl font-bold text-foreground mb-8'>
        Product Specifications
      </h2>
      <div className='bg-muted rounded-lg p-6 mt-6'>
        <dl className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4'>
          {specifications.map((spec, index) => (
            <div key={index} className='border-b border-border pb-3'>
              <dt className='text-sm font-semibold text-muted-foreground mb-1'>
                {spec.label}
              </dt>
              <dd className='text-base text-foreground'>
                {spec.links && spec.links.length > 0
                  ? spec.links.map((link, linkIndex) => (
                      <span key={linkIndex}>
                        {linkIndex > 0 && ', '}
                        <Link
                          href={link.url}
                          className='text-primary hover:text-primary-hover hover:underline transition-colors'
                        >
                          {link.text}
                        </Link>
                      </span>
                    ))
                  : spec.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
