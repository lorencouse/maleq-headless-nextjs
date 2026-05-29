/**
 * Localize the checkout shipping-tier names/descriptions under
 * `checkout.shippingMethod.tiers.<id>`.
 *
 * The tier definitions in lib/checkout/shipping-rates.ts stay the English
 * source + fallback. Only the SELECTOR display is localized — the name/
 * description stored on the order (CheckoutForm/ExpressCheckout) and sent to
 * analytics intentionally stay English to match the store/fulfillment record.
 * en/ja fall back to the rate literals; Simplified (zh.json) is regenerated
 * from zh-hant afterwards.
 *
 *   bun scripts/add-shipping-tiers-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

const TIERS_ES = {
  standard: { name: 'Envío estándar', description: '5-7 días hábiles' },
  express: { name: 'Envío exprés', description: '2-3 días hábiles' },
  'intl-standard': { name: 'Internacional estándar', description: '6-12 días hábiles' },
  'intl-priority': { name: 'Internacional prioritario', description: '3-6 días hábiles' },
};

const TIERS_ZH_HANT = {
  standard: { name: '標準運送', description: '5-7 個工作天' },
  express: { name: '快遞運送', description: '2-3 個工作天' },
  'intl-standard': { name: '國際標準', description: '6-12 個工作天' },
  'intl-priority': { name: '國際優先', description: '3-6 個工作天' },
};

function inject(localeFile: string, tiers: Record<string, unknown>) {
  const path = join(MESSAGES_DIR, localeFile);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.checkout?.shippingMethod) {
    throw new Error(`${localeFile}: missing "checkout.shippingMethod" namespace`);
  }
  data.checkout.shippingMethod.tiers = tiers;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Injected checkout.shippingMethod.tiers → ${localeFile}`);
}

inject('es.json', TIERS_ES);
inject('zh-hant.json', TIERS_ZH_HANT);
console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
