/**
 * Localize the fixed Product Specifications table labels (SKU, Brand, …) under
 * the `productRelated` namespace. The labels are generated in English by
 * lib/products/specifications.ts; ProductSpecifications (now a client
 * component) maps the English label → these keys with t.has() + fallback, so
 * en/ja render the English label and dynamic WP-attribute labels (Color,
 * Material, …) and all data VALUES stay English. Availability values reuse the
 * existing product.stock* keys. Simplified (zh.json) is regenerated after.
 *
 *   bun scripts/add-spec-labels-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

const LABELS: Record<string, Record<string, string>> = {
  es: {
    specSku: 'SKU',
    specBrand: 'Marca',
    specCategories: 'Categorías',
    specTags: 'Etiquetas',
    specWeight: 'Peso',
    specDimensions: 'Dimensiones',
    specAvailability: 'Disponibilidad',
    specStockQuantity: 'Cantidad en stock',
  },
  'zh-hant': {
    specSku: '貨號',
    specBrand: '品牌',
    specCategories: '分類',
    specTags: '標籤',
    specWeight: '重量',
    specDimensions: '尺寸',
    specAvailability: '供貨狀態',
    specStockQuantity: '庫存數量',
  },
};

for (const [locale, keys] of Object.entries(LABELS)) {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.productRelated) throw new Error(`${locale}.json: missing "productRelated" namespace`);
  Object.assign(data.productRelated, keys);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Added ${Object.keys(keys).length} spec-label keys → ${locale}.json`);
}

console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
