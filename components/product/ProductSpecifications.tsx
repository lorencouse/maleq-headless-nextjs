'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProductSpecification } from '@/lib/products/product-service';
import { useLocalizedCategoryName } from '@/lib/i18n/category-translations';
import {
  useLocalizedColorName,
  useLocalizedMaterialName,
  useLocalizedAttributeName,
} from '@/lib/i18n/attribute-translations';

interface ProductSpecificationsProps {
  specifications: ProductSpecification[];
}

// The fixed spec labels emitted by lib/products/specifications.ts → catalog
// keys (productRelated namespace). Dynamic WP-attribute labels (Color,
// Material, …) aren't here, so they fall back to their English label below.
const LABEL_KEY: Record<string, string> = {
  SKU: 'specSku',
  Brand: 'specBrand',
  Categories: 'specCategories',
  Tags: 'specTags',
  Weight: 'specWeight',
  Dimensions: 'specDimensions',
  Availability: 'specAvailability',
  'Stock Quantity': 'specStockQuantity',
};

// Only the Availability row has these fixed enum values → reuse the stock keys
// in the `product` namespace. All other values are product data (kept as-is).
const AVAILABILITY_VALUE_KEY: Record<string, string> = {
  'In Stock': 'stockInStock',
  'Out of Stock': 'stockOutOfStock',
  'On Backorder': 'stockOnBackorder',
};

// Client component so it localizes via ChromeLocaleProvider on the language
// switch, even though the product page is server-pinned to English. Labels, the
// Availability value, and category/color/material names (via the slug
// dictionaries) localize; other data values (brands, tags, dimensions, and
// other attribute values) stay English.
export default function ProductSpecifications({
  specifications,
}: ProductSpecificationsProps) {
  const t = useTranslations('productRelated');
  const tProduct = useTranslations('product');
  const localizeCategoryName = useLocalizedCategoryName();
  const localizeColorName = useLocalizedColorName();
  const localizeMaterialName = useLocalizedMaterialName();
  const localizeAttributeName = useLocalizedAttributeName();

  if (!specifications || specifications.length === 0) {
    return null;
  }

  // Fixed labels use the productRelated catalog keys; dynamic attribute labels
  // (Color, Material, Size, …) localize via the attribute-name dictionary.
  const labelText = (label: string) => {
    const key = LABEL_KEY[label];
    if (key && t.has(key)) return t(key);
    return localizeAttributeName(label, label);
  };

  // Link text localization by row: categories / colors / materials use their
  // slug dictionaries; everything else (brands, etc.) stays as-is.
  const linkText = (specLabel: string, link: { text: string; slug?: string }) => {
    if (specLabel === 'Categories') return localizeCategoryName(link.slug, link.text);
    if (specLabel === 'Color') return localizeColorName(link.slug, link.text);
    if (specLabel === 'Material') return localizeMaterialName(link.slug, link.text);
    return link.text;
  };

  const valueText = (spec: ProductSpecification) => {
    if (spec.label === 'Availability') {
      const key = AVAILABILITY_VALUE_KEY[spec.value];
      if (key && tProduct.has(key)) return tProduct(key);
    }
    return spec.value;
  };

  return (
    <div className='border-t border-border pt-8 mt-8'>
      <h2 className='text-2xl font-bold text-foreground mb-8'>
        {t('productSpecificationsHeading')}
      </h2>
      <div className='bg-muted rounded-lg p-6 mt-6'>
        <dl className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4'>
          {specifications.map((spec, index) => (
            <div key={index} className='border-b border-border pb-3'>
              <dt className='text-sm font-semibold text-muted-foreground mb-1'>
                {labelText(spec.label)}
              </dt>
              <dd className='text-base text-foreground'>
                {spec.links && spec.links.length > 0
                  ? spec.links.map((link, linkIndex) => (
                      <span key={linkIndex}>
                        {linkIndex > 0 && ', '}
                        <Link
                          href={link.url}
                          className='link-animated'
                        >
                          {linkText(spec.label, link)}
                        </Link>
                      </span>
                    ))
                  : valueText(spec)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
