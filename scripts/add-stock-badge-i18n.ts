/**
 * Add the StockStatusBadge labels to the `product` namespace of each catalog.
 *
 * StockStatusBadge is a client component, so it localizes via
 * ChromeLocaleProvider on the language switch even on the English-pinned
 * content-root product pages. `ja` gets the English values (it is still an
 * untranslated placeholder copy of en); Simplified (zh.json) is regenerated
 * from zh-hant by scripts/convert-zh-hant-to-hans.ts afterwards.
 *
 *   bun scripts/add-stock-badge-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

const KEYS: Record<string, Record<string, string>> = {
  en: {
    stockInStock: 'In Stock',
    stockLowStock: 'Low Stock',
    stockOutOfStock: 'Out of Stock',
    stockOnBackorder: 'On Backorder',
    stockLowStockLeft: 'Low Stock ({count} left)',
    stockQuantityAvailable: '({count} available)',
  },
  es: {
    stockInStock: 'En stock',
    stockLowStock: 'Pocas unidades',
    stockOutOfStock: 'Agotado',
    stockOnBackorder: 'Bajo pedido',
    stockLowStockLeft: 'Pocas unidades (quedan {count})',
    stockQuantityAvailable: '({count} disponibles)',
  },
  'zh-hant': {
    stockInStock: '有現貨',
    stockLowStock: '庫存不多',
    stockOutOfStock: '缺貨',
    stockOnBackorder: '可預購',
    stockLowStockLeft: '庫存不多（剩 {count} 件）',
    stockQuantityAvailable: '（尚有 {count} 件）',
  },
  // ja mirrors en (placeholder catalog, not yet translated).
  ja: {
    stockInStock: 'In Stock',
    stockLowStock: 'Low Stock',
    stockOutOfStock: 'Out of Stock',
    stockOnBackorder: 'On Backorder',
    stockLowStockLeft: 'Low Stock ({count} left)',
    stockQuantityAvailable: '({count} available)',
  },
};

for (const [locale, keys] of Object.entries(KEYS)) {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.product) throw new Error(`${locale}.json: missing "product" namespace`);
  Object.assign(data.product, keys);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Added ${Object.keys(keys).length} stock keys → ${locale}.json`);
}

console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
