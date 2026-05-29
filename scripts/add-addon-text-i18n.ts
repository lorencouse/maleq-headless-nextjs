/**
 * Localize the static product-addon titles/descriptions (the display text in
 * lib/config/product-addons.ts) under the `productAddons.items` catalog key.
 *
 * Keyed by addon id. The config strings stay the English source of truth +
 * runtime fallback, so `en` and the `ja` placeholder render straight from the
 * config and need no entry here — only the translated locales get overrides.
 * ProductAddons (a client component) resolves these with t.has() + fallback,
 * so they localize via ChromeLocaleProvider on the language switch.
 *
 * The addon `name` field (full WooCommerce product name) is intentionally NOT
 * localized: it is the cart/order line-item label and must match the store.
 * Simplified (zh.json) is regenerated from zh-hant afterwards.
 *
 *   bun scripts/add-addon-text-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

const ITEMS_ES = {
  'addon-toy-cleaner': {
    shortName: 'Limpiador de juguetes',
    description: 'Mantén tus juguetes higiénicos y seguros',
  },
  'addon-anal-lube': {
    shortName: 'Lubricante anal',
    description: 'Lubricante anal premium a base de agua',
  },
  'addon-enema': {
    shortName: 'Enema',
    description: 'Para una preparación cómoda',
  },
  'addon-bundle-all': {
    shortName: 'Kit de cuidado completo',
    description: 'Limpiador, lubricante y enema: todo lo que necesitas para la mejor experiencia',
  },
};

const ITEMS_ZH_HANT = {
  'addon-toy-cleaner': {
    shortName: '玩具清潔劑',
    description: '讓您的玩具保持衛生與安全',
  },
  'addon-anal-lube': {
    shortName: '後庭潤滑液',
    description: '頂級水性後庭潤滑液',
  },
  'addon-enema': {
    shortName: '灌洗器',
    description: '讓清潔準備更舒適',
  },
  'addon-bundle-all': {
    shortName: '完整保養組',
    description: '清潔劑、潤滑液與灌洗器——體驗最佳感受所需的一切',
  },
};

function inject(localeFile: string, items: Record<string, unknown>) {
  const path = join(MESSAGES_DIR, localeFile);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.productAddons) throw new Error(`${localeFile}: missing "productAddons" namespace`);
  data.productAddons.items = items;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Injected productAddons.items → ${localeFile}`);
}

inject('es.json', ITEMS_ES);
inject('zh-hant.json', ITEMS_ZH_HANT);
console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
