/**
 * Generate the Simplified-Chinese UI catalog (messages/zh.json) from the
 * Traditional one (messages/zh-hant.json) via OpenCC.
 *
 * The routing locale `zh` serves Simplified Chinese (hreflang zh-Hans);
 * `zh-hant` keeps the original Traditional/Taiwan catalog. Rather than
 * hand-translate, we convert Traditional → Simplified character-by-character
 * with OpenCC's `tw → cn` profile (Taiwan Traditional → Mainland Simplified,
 * including the handful of region-specific phrase differences).
 *
 * Only string *values* are converted; JSON keys, ICU placeholders ({name},
 * {count}), HTML tags, URLs and Latin brand names ("Male Q") are pure ASCII
 * and pass through untouched. Re-run this whenever zh-hant.json changes, then
 * eyeball the diff for any phrasing you want to tweak by hand.
 *
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as OpenCC from 'opencc-js';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');
const SOURCE = join(MESSAGES_DIR, 'zh-hant.json');
const TARGET = join(MESSAGES_DIR, 'zh.json');

const convert = OpenCC.Converter({ from: 'tw', to: 'cn' });

let stringCount = 0;
function deepConvert(value: unknown): unknown {
  if (typeof value === 'string') {
    stringCount += 1;
    return convert(value);
  }
  if (Array.isArray(value)) return value.map(deepConvert);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Keys stay as-is (they are stable English identifiers); convert values.
      out[k] = deepConvert(v);
    }
    return out;
  }
  return value;
}

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const converted = deepConvert(source);
// Trailing newline to match the repo's other catalogs.
writeFileSync(TARGET, JSON.stringify(converted, null, 2) + '\n', 'utf8');

console.log(`Converted ${stringCount} strings → ${TARGET}`);
