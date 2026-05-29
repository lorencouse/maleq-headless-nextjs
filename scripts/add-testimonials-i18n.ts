/**
 * Localize the baked home-page testimonial review TEXT under
 * `home.testimonials.items.<id>.text`.
 *
 * The testimonials array in components/home/TestimonialsSection.tsx stays the
 * English source + fallback; only the review body is translated. Reviewer
 * names and US city/state locations are proper nouns and stay as-is (same
 * convention as the warehouse place names elsewhere). en/ja fall back to the
 * component literals; Simplified (zh.json) is regenerated from zh-hant after.
 *
 *   bun scripts/add-testimonials-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

const ITEMS_ES: Record<string, { text: string }> = {
  '1': {
    text: 'Envío rápido y el embalaje era totalmente discreto. Nadie sabría jamás lo que había dentro. ¡La calidad del producto superó mis expectativas!',
  },
  '2': {
    text: 'Las guías de este sitio realmente me ayudaron a tomar una decisión informada. Sin tácticas de venta agresivas, solo información honesta. Sin duda volveré a comprar aquí.',
  },
  '3': {
    text: 'El servicio al cliente fue increíblemente útil cuando tuve preguntas. Respondieron con rapidez y profesionalidad. El producto llegó en perfecto estado.',
  },
  '4': {
    text: 'Los mejores precios que encontré en línea para marcas premium. La garantía de calidad me dio la confianza para probar algo nuevo. Muy satisfecho con mi compra.',
  },
};

const ITEMS_ZH_HANT: Record<string, { text: string }> = {
  '1': {
    text: '出貨快速，包裝非常隱密，完全看不出裡面裝了什麼。產品品質超乎我的預期！',
  },
  '2': {
    text: '這個網站的指南真的幫助我做出了明智的選擇。沒有強迫推銷，只有誠實的資訊。我一定會再回來購買。',
  },
  '3': {
    text: '我有問題時，客服非常樂於協助，回覆既快速又專業。產品送達時狀況完美無瑕。',
  },
  '4': {
    text: '這是我在網路上找到的頂級品牌最優惠的價格。品質保證讓我有信心嘗試新的東西。對我的購買非常滿意。',
  },
};

function inject(localeFile: string, items: Record<string, unknown>) {
  const path = join(MESSAGES_DIR, localeFile);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.home?.testimonials) {
    throw new Error(`${localeFile}: missing "home.testimonials" namespace`);
  }
  data.home.testimonials.items = items;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Injected home.testimonials.items → ${localeFile}`);
}

inject('es.json', ITEMS_ES);
inject('zh-hant.json', ITEMS_ZH_HANT);
console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
