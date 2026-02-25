/**
 * Product Description Cleanup Script
 *
 * Transforms plain-text product descriptions into structured HTML.
 * Detects sections, spec tables, feature lists, and narrative text.
 *
 * Usage:
 *   bun scripts/cleanup-descriptions.ts --local                      # dry-run, 10 samples
 *   bun scripts/cleanup-descriptions.ts --local --limit 50           # dry-run, 50 products
 *   bun scripts/cleanup-descriptions.ts --local --id 12345           # preview single product
 *   bun scripts/cleanup-descriptions.ts --local --apply              # apply to all
 *   bun scripts/cleanup-descriptions.ts --local --apply --limit 100  # apply to first 100
 */

import { getConnection } from './lib/db';

// ─── Known acronyms (never title-case these) ────────────────────────────────
const ACRONYMS = new Set([
  'USB', 'ABS', 'TPE', 'TPR', 'LED', 'LCD', 'PVC', 'UV', 'DC', 'AC',
  'IPX7', 'IPX5', 'IPX6', 'FDA', 'CE', 'ROHS', 'DEHP', 'BPA',
  'AAA', 'AA', 'XS', 'XL', 'XXL', 'OS', 'OSFM', 'RPM',
  'USA', 'UK', 'EU', 'II', 'III', 'IV',
]);

// ─── Common misspellings in product feeds ────────────────────────────────────
const MISSPELLINGS: Record<string, string> = {
  'vibtrator': 'vibrator',
  'virbator': 'vibrator',
  'vibator': 'vibrator',
  'vibraor': 'vibrator',
  'vibratior': 'vibrator',
  'vibrtor': 'vibrator',
  'rechargable': 'rechargeable',
  'rechareable': 'rechargeable',
  'waterprof': 'waterproof',
  'waterpoof': 'waterproof',
  'waterproff': 'waterproof',
  'silcone': 'silicone',
  'slicone': 'silicone',
  'sillicone': 'silicone',
  'siliconce': 'silicone',
  'phthlate': 'phthalate',
  'phtalate': 'phthalate',
  'phlatate': 'phthalate',
  'phthlalate': 'phthalate',
  'hypoalergenic': 'hypoallergenic',
  'hypoallergnic': 'hypoallergenic',
  'dimentions': 'dimensions',
  'dimesions': 'dimensions',
  'dimenstions': 'dimensions',
  'measurments': 'measurements',
  'measurmenets': 'measurements',
  'adjustible': 'adjustable',
  'adjsutable': 'adjustable',
  'compatable': 'compatible',
  'compatble': 'compatible',
  'compatabile': 'compatible',
  'stimualtion': 'stimulation',
  'stimualation': 'stimulation',
  'stimlation': 'stimulation',
  'pleasrue': 'pleasure',
  'pleasue': 'pleasure',
  'ergonomc': 'ergonomic',
  'erognomice': 'ergonomic',
  'insertible': 'insertable',
  'flexable': 'flexible',
  'flexibile': 'flexible',
  'powerfull': 'powerful',
  'beatiful': 'beautiful',
  'beutiful': 'beautiful',
  'luxurious': 'luxurious',
  'luxurios': 'luxurious',
  'senstaion': 'sensation',
  'sensaiton': 'sensation',
  'intensley': 'intensely',
  'intesely': 'intensely',
  'realsitic': 'realistic',
  'realitsic': 'realistic',
  'matierial': 'material',
  'materal': 'material',
  'diamater': 'diameter',
  'dimaeter': 'diameter',
  'cirumference': 'circumference',
  'circumfrence': 'circumference',
  'lenght': 'length',
  'widht': 'width',
  'hieght': 'height',
  'heigth': 'height',
  'battrey': 'battery',
  'baterry': 'battery',
  'removeable': 'removable',
  'discreet': 'discreet',
  'disceet': 'discreet',
  'guarentee': 'guarantee',
  'waranty': 'warranty',
  'warrnaty': 'warranty',
};

// Build regex for misspellings (case-insensitive, word-boundary)
const misspellingRegex = new RegExp(
  '\\b(' + Object.keys(MISSPELLINGS).join('|') + ')\\b',
  'gi'
);

// ─── Section header patterns ─────────────────────────────────────────────────
// Headers that require a colon after them
const SECTION_HEADERS_WITH_COLON = [
  'Key Features',
  'Features',
  'Product Features',
  'Special Features',
  'Specifications',
  'Product Specifications',
  'Product Dimensions',
  'Product dimensions',
  'Package Dimensions',
  'Measurements',
  'Dimensions',
  'Materials',
  'Material',
  'Contents Included',
  'Contents',
  'Includes',
  'What\'s Included',
  'Package Includes',
  'Warranty',
  'Note',
  'Please Note',
  'Important',
  'Instructions',
  'How to Use',
  'Care Instructions',
  'Cleaning',
  'Description',
  'Product Description',
  'About',
  'Overview',
  'Key features',
];

// Headers that stand alone (no colon required)
const SECTION_HEADERS_NO_COLON = [
  'Panel Details',
  'Size Specs',
  'Product dimensions',
  'Product Dimensions',
  'Package Dimensions',
  'Measurements',
  'Specifications',
  'Key features',
  'Key Features',
];

// Section headers that indicate spec/measurement content (use generic splitter)
const SPEC_SECTION_HEADERS = new Set([
  'specifications', 'product specifications', 'product dimensions',
  'package dimensions', 'measurements', 'dimensions',
  'panel details', 'size specs', 'materials',
]);

// Combined regex: headers with colon + headers without colon
const colonHeadersPattern = SECTION_HEADERS_WITH_COLON.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const noColonHeadersPattern = SECTION_HEADERS_NO_COLON.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Match either "Header:" (with colon) or standalone "Panel Details" / "Size Specs"
// No-colon headers can appear anywhere (often glued to previous text)
const sectionHeaderRegex = new RegExp(
  '(?:(?:^|(?<=\\.\\s)|(?<=\\. )|(?<=\\.))(?:(' + colonHeadersPattern + ')\\s*:\\s*)' +
  '|(' + noColonHeadersPattern + '))',
  'gi'
);

// Spec-line patterns: "Key: Value" where Key is 1-4 capitalized words
const SPEC_LINE_RE = /^([A-Za-z][A-Za-z\s\/&()]{1,40})\s*:\s*(.+)$/;

// Generic pattern: "Capitalized Word(s): short value" — for detecting specs
// in content under spec-like section headers without needing a known key list
const GENERIC_SPEC_RE = /^([A-Z][A-Za-z\s\/&()]{1,40})\s*:\s*(.{1,80})$/;

// ─── Formatting pipeline ─────────────────────────────────────────────────────

function stripTrailingCategories(text: string): string {
  // Remove "Categories: ..." and everything after it (images, video, warranty lines)
  return text.replace(
    /\s*Categories\s*:\s*[^]*$/i,
    ''
  ).trim();
}

function stripExistingHtml(text: string): string {
  // Remove HTML tags to get plain text for re-processing
  return text
    .replace(/<\/?(p|h[1-6]|ul|ol|li|table|tbody|thead|tr|th|td|div|span|br|strong|em|b|i)\s*\/?>/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fixTextArtifacts(text: string): string {
  return text
    .replace(/`/g, "'")                          // backtick → apostrophe
    .replace(/&amp;/g, '&')                      // HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')                     // collapse multiple spaces
    .replace(/\.([A-Z])/g, '. $1')               // missing space after period before uppercase
    .replace(/,([A-Za-z])/g, ', $1')             // missing space after comma
    .trim();
}

function fixMisspellings(text: string): string {
  return text.replace(misspellingRegex, (match) => {
    const lower = match.toLowerCase();
    const replacement = MISSPELLINGS[lower];
    if (!replacement) return match;
    // Preserve original case pattern
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

function fixAllCaps(text: string): string {
  // Title-case words that are ALL CAPS and longer than 3 chars (unless acronym)
  return text.replace(/\b([A-Z]{4,})\b/g, (match) => {
    if (ACRONYMS.has(match)) return match;
    return match[0] + match.slice(1).toLowerCase();
  });
}

// ─── Section detection & HTML generation ─────────────────────────────────────

interface Section {
  header: string | null;
  content: string;
}

function splitIntoSections(text: string): Section[] {
  const sections: Section[] = [];
  const headerPositions: { index: number; header: string; matchLen: number }[] = [];

  const re = new RegExp(sectionHeaderRegex.source, sectionHeaderRegex.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const header = m[1] || m[2];
    headerPositions.push({ index: m.index, header, matchLen: m[0].length });
  }

  if (headerPositions.length === 0) {
    return [{ header: null, content: text.trim() }];
  }

  const introText = text.slice(0, headerPositions[0].index).trim();
  if (introText) {
    sections.push({ header: null, content: introText });
  }

  for (let i = 0; i < headerPositions.length; i++) {
    const start = headerPositions[i].index + headerPositions[i].matchLen;
    const end = i + 1 < headerPositions.length ? headerPositions[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      sections.push({ header: headerPositions[i].header, content });
    }
  }

  return sections;
}

/**
 * Split concatenated spec content using a generic approach.
 * Splits on "Capitalized Key Phrase:" patterns (2+ chars before colon).
 * Only used within spec-like section headers.
 */
function splitGenericSpecs(content: string): string[] {
  // Split where a value ends and a new "Key phrase:" begins.
  // Value endings: digits, %, ", uppercase acronyms, Yes/No, unit words
  // Key must start with uppercase letter followed by lowercase (not mid-acronym)
  const re = /(?<=[0-9%"A-Z]|(?<=\b(?:Yes|No|None|min|dB|inches|inch|mm|cm|oz|lbs|RPM|spandex))) (?=[A-Z][a-z]+(?:\s+[a-z]+)*\s*:)/g;
  const parts = content.split(re);
  if (parts.length >= 2) return parts.filter(s => s.trim());
  // Fall back to period-separated
  return content.split(/\.\s+|\.\s*$/).filter(s => s.trim());
}

function isSpecContent(content: string, isSpecSection: boolean): boolean {
  const chunks = isSpecSection ? splitGenericSpecs(content) : splitByPeriods(content);
  let specCount = 0;
  for (const s of chunks) {
    const trimmed = s.trim().replace(/\.$/, '');
    if (SPEC_LINE_RE.test(trimmed)) specCount++;
  }
  return specCount >= 2;
}

function splitByPeriods(content: string): string[] {
  return content.split(/\.\s+|\.\s*$/).filter(s => s.trim());
}

function parseSpecLines(content: string, isSpecSection: boolean): { key: string; value: string }[] {
  const specs: { key: string; value: string }[] = [];
  const chunks = isSpecSection ? splitGenericSpecs(content) : splitByPeriods(content);
  for (const chunk of chunks) {
    const trimmed = chunk.trim().replace(/\.$/, '');
    if (!trimmed) continue;
    const m = trimmed.match(SPEC_LINE_RE);
    if (m) {
      const value = m[2].trim().replace(/\.$/, '').replace(/,\s*$/, '');
      // Skip if value is too long (likely narrative, not a spec)
      if (value.length > 120) continue;
      specs.push({ key: m[1].trim(), value });
    }
  }
  return specs;
}

function isFeatureList(content: string): boolean {
  const items = content.split(/\.\s+/).filter(s => s.trim().length > 0);
  if (items.length < 3) return false;
  const shortItems = items.filter(s => s.trim().length < 80);
  return shortItems.length / items.length > 0.7;
}

function buildSpecTable(header: string, specs: { key: string; value: string }[]): string {
  const rows = specs.map(s => `<tr><th>${escHtml(s.key)}</th><td>${escHtml(s.value)}</td></tr>`).join('\n');
  return `<h3>${escHtml(header)}</h3>\n<table><tbody>\n${rows}\n</tbody></table>`;
}

function buildFeatureList(header: string, content: string): string {
  const items = content.split(/\.\s+/)
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(s => s.length > 0);
  const lis = items.map(item => `<li>${escHtml(item)}</li>`).join('\n');
  return `<h3>${escHtml(header)}</h3>\n<ul>\n${lis}\n</ul>`;
}

function buildParagraphs(text: string): string {
  const sentences = text.split(/(?<=\.)\s+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return '';
  if (sentences.length <= 4) {
    return `<p>${escHtml(sentences.join(' '))}</p>`;
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    const group = sentences.slice(i, i + 3);
    paragraphs.push(`<p>${escHtml(group.join(' '))}</p>`);
  }
  return paragraphs.join('\n');
}

function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeHeading(header: string): string {
  const normalized = header.trim().replace(/\s+/g, ' ');
  const key = normalized.toLowerCase();

  const map: Record<string, string> = {
    'key feature': 'Key Features',
    'key features': 'Key Features',
    'product dimensions': 'Product Dimensions',
    'package dimensions': 'Package Dimensions',
    'panel details': 'Panel Details',
    'size specs': 'Size Specs',
    'product specifications': 'Product Specifications',
    'materials': 'Materials',
    'material': 'Material',
    'measurements': 'Measurements',
    'specifications': 'Specifications',
    'description': 'Description',
    'note': 'Note',
  };

  if (map[key]) return map[key];

  const smallWords = new Set(['and', 'or', 'of', 'in', 'to', 'for', 'with', 'without', 'at', 'by', 'from', 'on']);
  return normalized
    .split(/\s+/)
    .map((word, idx) => {
      const clean = word.trim();
      if (!clean) return clean;
      const upper = clean.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      const lower = clean.toLowerCase();
      if (idx > 0 && smallWords.has(lower)) return lower;
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function sectionToHtml(section: Section): string {
  const { header, content } = section;

  if (!header) {
    return buildParagraphs(content);
  }

  const heading = normalizeHeading(header);
  const isSpecSection = SPEC_SECTION_HEADERS.has(heading.toLowerCase());

  // Check for spec-like content
  if (isSpecContent(content, isSpecSection)) {
    const specs = parseSpecLines(content, isSpecSection);
    if (specs.length >= 2) {
      const specKeys = new Set(specs.map(s => s.key));
      const chunks = isSpecSection ? splitGenericSpecs(content) : splitByPeriods(content);
      const remaining = chunks
        .map(s => s.trim().replace(/\.$/, ''))
        .filter(s => {
          const m = s.match(SPEC_LINE_RE);
          if (!m) return true;
          if (specKeys.has(m[1].trim())) return false;
          // Also exclude if value was too long (skipped in parseSpecLines)
          return true;
        })
        .filter(s => s.length > 0);

      let html = buildSpecTable(heading, specs);
      if (remaining.length > 0) {
        html += '\n' + buildParagraphs(remaining.join('. ') + '.');
      }
      return html;
    }
  }

  // Check for feature list
  if (isFeatureList(content)) {
    return buildFeatureList(heading, content);
  }

  // Default: heading + paragraphs
  return `<h3>${escHtml(heading)}</h3>\n${buildParagraphs(content)}`;
}

// ─── Reformat existing HTML (fix spec blobs inside <p> tags) ─────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/andamp;/g, '&')         // double-encoded &amp; artifact
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

interface ParsedSpecsResult {
  specs: { key: string; value: string }[];
  remaining: string;
}

const UNIT_PATTERN = '(?:inches?|inch|in\\.?|cm|mm|oz|lbs?|lb|g|kg|mL|ml|["”″])';
const UNIT_RE = new RegExp(`\\b${UNIT_PATTERN}\\b`, 'i');
const KEY_BEFORE_VALUE_RE = new RegExp(
  `^([A-Za-z][A-Za-z0-9\\s()\\/-]{1,70}?)(?:\\s*:\\s*|\\s+)([0-9]+(?:\\.[0-9]+)?\\s*${UNIT_PATTERN})(?:\\b|$)`,
  'i'
);
const VALUE_BEFORE_KEY_RE = new RegExp(
  `^([0-9]+(?:\\.[0-9]+)?\\s*${UNIT_PATTERN})\\s+([A-Za-z][A-Za-z0-9\\s()\\/-]{1,70})$`,
  'i'
);
const PREFIXED_MEASUREMENT_RE = new RegExp(
  `([0-9]+(?:\\.[0-9]+)?\\s*${UNIT_PATTERN})\\s*(long|length|wide|width|diameter|height|insertable length|insertable diameter|overall length|overall diameter|base height|massager head)?`,
  'gi'
);

function normalizeMeasurementValue(value: string): string {
  return value
    .replace(/[”″]/g, ' in')
    .replace(/\bin\./gi, 'in')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

function normalizeSpecKey(key: string): string {
  const clean = key.trim().replace(/\s+/g, ' ');
  if (!clean) return clean;
  const normalized = normalizeHeading(clean).replace(/^(In|At|For)\s+/i, '');
  return normalized || 'Measurement';
}

function dedupeSpecs(specs: { key: string; value: string }[]): { key: string; value: string }[] {
  const seen = new Set<string>();
  const keyCounts = new Map<string, number>();
  const deduped: { key: string; value: string }[] = [];

  for (const spec of specs) {
    const cleanKey = normalizeSpecKey(spec.key);
    const cleanValue = spec.value.trim().replace(/\.$/, '');
    if (!cleanKey || !cleanValue) continue;

    const signature = `${cleanKey.toLowerCase()}|${cleanValue.toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    const count = (keyCounts.get(cleanKey.toLowerCase()) || 0) + 1;
    keyCounts.set(cleanKey.toLowerCase(), count);
    const finalKey = count > 1 ? `${cleanKey} ${count}` : cleanKey;
    deduped.push({ key: finalKey, value: cleanValue });
  }

  return deduped;
}

function parseNarrativeSpecs(text: string): ParsedSpecsResult {
  const specs: { key: string; value: string }[] = [];
  const remaining: string[] = [];

  const normalizedText = text.replace(/\s*-\s*(?=[A-Za-z][A-Za-z\s]{1,30}:)/g, ', ');
  const pieces = normalizedText
    .replace(/^Measurements?\s*:?\s*/i, '')
    .split(/\s*;\s*|\s*,\s*|(?<=\.)\s+/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter((s) => s.length > 0);

  for (const rawPiece of pieces) {
    const piece = rawPiece.replace(/\s+/g, ' ').trim();
    if (!piece) continue;

    const materialMatch = piece.match(/^Materials?\s*:?\s*(.+)$/i);
    if (materialMatch) {
      specs.push({ key: 'Material', value: materialMatch[1].trim() });
      continue;
    }

    const colorMatch = piece.match(/^Colors?\s*:?\s*(.+)$/i);
    if (colorMatch) {
      specs.push({ key: 'Color', value: colorMatch[1].trim() });
      continue;
    }

    const prefixed = piece.match(/^([A-Za-z][A-Za-z\s]{1,30})\s*:\s*(.+)$/);
    if (prefixed) {
      const prefix = normalizeSpecKey(prefixed[1]);
      const body = prefixed[2].trim();
      const matches = [...body.matchAll(PREFIXED_MEASUREMENT_RE)];
      if (matches.length > 0) {
        for (const m of matches) {
          const value = normalizeMeasurementValue(m[1]);
          const suffix = m[2] ? ` ${normalizeSpecKey(m[2])}` : '';
          specs.push({ key: `${prefix}${suffix}`.trim(), value });
        }
        continue;
      }
      if (UNIT_RE.test(body)) {
        specs.push({ key: prefix, value: normalizeMeasurementValue(body) });
        continue;
      }
    }

    const explicit = piece.match(SPEC_LINE_RE);
    if (explicit && UNIT_RE.test(explicit[2])) {
      specs.push({
        key: normalizeSpecKey(explicit[1]),
        value: normalizeMeasurementValue(explicit[2]),
      });
      continue;
    }

    const keyBefore = piece.match(KEY_BEFORE_VALUE_RE);
    if (keyBefore) {
      specs.push({
        key: normalizeSpecKey(keyBefore[1]),
        value: normalizeMeasurementValue(keyBefore[2]),
      });
      const rest = piece.slice(keyBefore[0].length).trim();
      if (rest && !/^and\b/i.test(rest)) remaining.push(rest);
      continue;
    }

    const valueBefore = piece.match(VALUE_BEFORE_KEY_RE);
    if (valueBefore) {
      specs.push({
        key: normalizeSpecKey(valueBefore[2]),
        value: normalizeMeasurementValue(valueBefore[1]),
      });
      continue;
    }

    const valueBeforeLoose = piece.match(new RegExp(
      `^([0-9]+(?:\\.[0-9]+)?\\s*${UNIT_PATTERN})\\s+([A-Za-z][A-Za-z0-9\\s()\\/-]{1,70}?)(?=\\s+(?:Material|Materials|Color|Warning|Note)\\b|$)`,
      'i'
    ));
    if (valueBeforeLoose) {
      specs.push({
        key: normalizeSpecKey(valueBeforeLoose[2]),
        value: normalizeMeasurementValue(valueBeforeLoose[1]),
      });
      const rest = piece.slice(valueBeforeLoose[0].length).trim().replace(/^[:.\-]\s*/, '');
      if (rest) remaining.push(rest);
      continue;
    }

    const standaloneVolume = piece.match(/^([0-9]+(?:\.[0-9]+)?\s*(?:fluid ounces?|ounces?|oz|mL|ml))$/i);
    if (standaloneVolume) {
      specs.push({ key: 'Volume', value: normalizeMeasurementValue(standaloneVolume[1]) });
      continue;
    }

    if (/^one size fits most$/i.test(piece)) {
      specs.push({ key: 'Size', value: 'One size fits most' });
      continue;
    }

    remaining.push(piece);
  }

  const cleanedRemaining: string[] = [];
  for (const fragment of remaining) {
    let working = fragment.trim();
    if (!working) continue;

    const embeddedMaterial = working.match(/\bMaterials?\s*:\s*([^.;]+?)(?=\s+Warning:|$|[.;])(.*)$/i);
    if (embeddedMaterial) {
      specs.push({ key: 'Material', value: embeddedMaterial[1].trim() });
      working = embeddedMaterial[2].trim();
    }

    const embeddedColor = working.match(/\bColors?\s*:\s*([^.;]+?)(?=\s+Warning:|$|[.;])(.*)$/i);
    if (embeddedColor) {
      specs.push({ key: 'Color', value: embeddedColor[1].trim() });
      working = embeddedColor[2].trim();
    }

    working = working.replace(/^[,;.\s]+/, '').trim();
    working = working.replace(/^Approx\.?\s*/i, '').trim();
    if (working) cleanedRemaining.push(working);
  }

  return {
    specs: dedupeSpecs(specs),
    remaining: cleanedRemaining.join(' ').replace(/\s{2,}/g, ' ').trim(),
  };
}

function expandCompactSizeSeries(key: string, value: string): { rows: { key: string; value: string }[]; extras: { key: string; value: string }[] } | null {
  const keyLc = key.toLowerCase();
  const looksLikeSeries =
    /smallest to largest/.test(keyLc) ||
    (value.includes(';') && /in\s+length/i.test(value) && /in\s+diameter/i.test(value));

  if (!looksLikeSeries) return null;

  const extras: { key: string; value: string }[] = [];
  let working = value.trim().replace(/\.$/, '');

  const materialMatch = working.match(/\bMaterials?\s*:?\s*([^.;]+)$/i);
  if (materialMatch && materialMatch.index !== undefined) {
    extras.push({ key: 'Material', value: materialMatch[1].trim() });
    working = working.slice(0, materialMatch.index).trim().replace(/[.;]\s*$/, '');
  }

  const segments = working
    .split(/\s*;\s*/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter((s) => s.length > 0);

  if (segments.length < 2) return null;

  const rows: { key: string; value: string }[] = [];
  let idx = 1;
  for (const segment of segments) {
    const lengthMatch = segment.match(/([0-9]+(?:\.[0-9]+)?)\s*(inch(?:es)?)\s+in\s+length/i);
    const diameterMatch = segment.match(/([0-9]+(?:\.[0-9]+)?)\s*(inch(?:es)?)\s+in\s+diameter/i);

    if (lengthMatch || diameterMatch) {
      const parts: string[] = [];
      if (lengthMatch) parts.push(`Length ${lengthMatch[1]} ${lengthMatch[2]}`);
      if (diameterMatch) parts.push(`Diameter ${diameterMatch[1]} ${diameterMatch[2]}`);
      rows.push({ key: `Size ${idx}`, value: parts.join('; ') });
    } else {
      const parsed = parseNarrativeSpecs(segment);
      if (parsed.specs.length >= 2) {
        const merged = parsed.specs.map((s) => `${s.key} ${s.value}`).join('; ');
        rows.push({ key: `Size ${idx}`, value: merged });
      } else {
        rows.push({ key: `Size ${idx}`, value: segment });
      }
    }
    idx++;
  }

  if (rows.length < 2) return null;
  return { rows, extras };
}

function buildFeatureListItems(content: string): string[] {
  const embedded = splitEmbeddedFeatures(content);
  if (embedded.length >= 2) {
    return embedded.map((f) => {
      if (f.key) return `<li><strong>${escHtml(f.key)}</strong> - ${escHtml(f.value)}</li>`;
      return `<li>${escHtml(f.value)}</li>`;
    });
  }

  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[.!?]\s*$/, ''))
    .filter((s) => s.length > 0);

  if (sentences.length >= 3) {
    return sentences.map((s) => `<li>${escHtml(s)}</li>`);
  }

  const commaItems = content
    .split(/\s*,\s*/)
    .map((s) => s.trim().replace(/[.!?]\s*$/, ''))
    .filter((s) => s.length > 0);
  if (commaItems.length >= 3 && commaItems.every((s) => s.length <= 120)) {
    return commaItems.map((s) => `<li>${escHtml(s)}</li>`);
  }

  return [];
}

/**
 * Split a long text value at embedded sub-feature headers.
 * Pattern: "Intro text. Sub Feature: Description! Another Feature: More text"
 * Returns array of { key, value } pairs. First item may have no key (intro text).
 */
function splitEmbeddedFeatures(text: string): { key: string | null; value: string }[] {
  // Match sub-feature headers: "Word(s):" preceded by sentence-ending punctuation or start
  // Handles hyphens (Nickel-Free), ampersands (Adjustable & Easy), and "and" connectors.
  // Also allows comma-separated feature fragments.
  const re = /(?:^|(?<=[.!?,]\s*))([A-Z][A-Za-z]+(?:[-][A-Z][A-Za-z]+)?(?:(?:\s+(?:&|and)\s+|\s+)[A-Z][A-Za-z]+(?:[-][A-Z][A-Za-z]+)?)*)\s*:\s*/g;
  const parts: { key: string | null; value: string }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    // Grab text before this match as the previous item's value
    const before = text.slice(lastIdx, m.index).trim();
    if (before && lastIdx === 0) {
      // Intro text before any sub-feature header
      parts.push({ key: null, value: before });
    } else if (before && parts.length > 0) {
      // Append to previous item's value
      parts[parts.length - 1].value += ' ' + before;
    }
    parts.push({ key: m[1], value: '' });
    lastIdx = m.index + m[0].length;
  }

  // Remaining text goes to the last part
  const remaining = text.slice(lastIdx).trim();
  if (remaining) {
    if (parts.length > 0) {
      parts[parts.length - 1].value = remaining;
    } else {
      parts.push({ key: null, value: remaining });
    }
  }

  // Clean up: trim values, remove trailing punctuation
  // Truncate excessively long values to first 2-3 sentences (narrative doesn't belong in feature list)
  for (const p of parts) {
    p.value = p.value.trim().replace(/[.!?,]\s*$/, '').trim();
    if (p.value.length > 250 && p.key) {
      const sentences = p.value.split(/(?<=[.!?])\s+/);
      // Keep first 2 sentences max
      const truncated = sentences.slice(0, 2).join(' ').replace(/[.!?]\s*$/, '').trim();
      if (truncated.length > 20) {
        p.value = truncated;
      }
    }
  }

  return parts.filter(p => p.value.length > 0 || p.key);
}

/**
 * Extract embedded measurements from end of text.
 * Pattern: "...text Measurements: Overall length: 4.4 inchesInsertable length: 3.6 inches"
 */
function extractEmbeddedMeasurements(text: string): { cleanText: string; measurements: { key: string; value: string }[] } {
  const measIdx = text.search(/\bMeasurements?\s*:/i);
  if (measIdx === -1) return { cleanText: text, measurements: [] };

  const measText = text.slice(measIdx).replace(/^Measurements?\s*:\s*/i, '');
  const cleanText = text.slice(0, measIdx).trim();

  // Split concatenated measurements (e.g., "Overall length: 4.4 inchesInsertable length: 3.6 inches")
  const specRe = /([A-Za-z][A-Za-z\s]{1,30})\s*:\s*([\d.]+\s*(?:inches|inch|in|cm|mm|oz|lbs|g|kg|mL|ml)[^A-Z]*)/gi;
  const measurements: { key: string; value: string }[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = specRe.exec(measText)) !== null) {
    measurements.push({ key: sm[1].trim(), value: sm[2].trim() });
  }

  return { cleanText, measurements };
}

function reformatExistingHtml(html: string): string {
  // Global text fixes (applies to all HTML content)
  let result = html
    .replace(/andamp;/g, '&amp;')   // double-encoded &amp; artifact → proper &amp;
    .replace(/([a-z0-9])([A-Z][a-z]+(?:\s+[a-z]+){0,3}:)(?=[^<]*<)/g, '$1 $2');  // missing space before "Note:" etc. in text

  // Normalize heading casing for consistency across product descriptions.
  result = result.replace(/<h3>\s*([^<]+?)\s*<\/h3>/g, (_match, heading: string) => {
    return `<h3>${escHtml(normalizeHeading(decodeHtmlEntities(heading)))}</h3>`;
  });

  // Fix tables where values are too long (narrative text wrongly in spec table)
  // Optionally capture preceding <h3> heading to avoid orphaned headings
  result = result.replace(/(?:(<h3>[^<]+<\/h3>)\s*)?<table><tbody>\n?([\s\S]*?)\n?<\/tbody><\/table>/g, (_match, precedingH3: string | undefined, tbody: string) => {
    const rows = [...tbody.matchAll(/<tr><th>([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><\/tr>/g)];
    if (rows.length === 0) return _match;

    // Check if any value is too long for a spec table
    const maxValueLen = Math.max(...rows.map(r => r[2].length));
    const avgValueLen = rows.reduce((sum, r) => sum + r[2].length, 0) / rows.length;
    if (maxValueLen <= 150 && avgValueLen <= 80) {
      // Fix concatenated values within short tables (e.g., "Silicone Syringe: Polypropylene")
      // and missing spaces (e.g., "whiteNote:")
      let fixedTbody = tbody;
      fixedTbody = fixedTbody.replace(/<tr><th>([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><\/tr>/g, (_rowMatch, thContent: string, tdContent: string) => {
        let val = decodeHtmlEntities(tdContent);
        const th = decodeHtmlEntities(thContent);
        // Fix missing space before "Note:" pattern
        val = val.replace(/([a-z0-9])([A-Z][a-z]+(?:\s+[a-z]+){0,3}:)/g, '$1 $2');
        // Split concatenated sub-values (e.g., "Yes Phthalate free: Yes")
        const subSpecs = splitGenericSpecs(val);
        if (subSpecs.length >= 2) {
          const firstRow = `<tr><th>${escHtml(th)}</th><td>${escHtml(subSpecs[0].trim())}</td></tr>`;
          const extraRows = subSpecs.slice(1).map(s => {
            const m = s.trim().match(SPEC_LINE_RE);
            if (m) return `<tr><th>${escHtml(m[1].trim())}</th><td>${escHtml(m[2].trim())}</td></tr>`;
            return `<tr><th></th><td>${escHtml(s.trim())}</td></tr>`;
          }).join('\n');
          return `${firstRow}\n${extraRows}`;
        }
        // Just fix the missing spaces
        return `<tr><th>${escHtml(th)}</th><td>${escHtml(val)}</td></tr>`;
      });
      if (fixedTbody !== tbody) {
        return `${precedingH3 ? precedingH3 + '\n' : ''}<table><tbody>\n${fixedTbody}\n</tbody></table>`;
      }
      return _match;
    }
    const origHeading = precedingH3 || '';

    // Known section headers that can appear embedded in table values
    const EMBEDDED_SECTION_RE = /\b(Key [Ff]eatures|Features|Materials|Measurements|Specifications|Note)\s*:\s*/;

    // Split rows into: table rows (short values) and extracted sections (long/embedded values)
    const tableRows: { key: string; value: string }[] = [];
    const extraSections: string[] = [];
    const measurementSpecs: { key: string; value: string }[] = [];

    for (const r of rows) {
      const key = decodeHtmlEntities(r[1]);
      let val = decodeHtmlEntities(r[2]);

      // Fix missing spaces before capitalized words (e.g., "whiteNote:" → "white Note:")
      val = val.replace(/([a-z0-9])([A-Z][a-z]+(?:\s+[a-z]+){0,3}:)/g, '$1 $2');

      // Expand compact size ranges (e.g., "from smallest to largest ...; ...; ...").
      const expandedSeries = expandCompactSizeSeries(key, val);
      if (expandedSeries) {
        tableRows.push(...expandedSeries.rows);
        if (expandedSeries.extras.length > 0) {
          tableRows.push(...expandedSeries.extras);
        }
        continue;
      }

      // Check if value contains an embedded section header
      const sectionMatch = val.match(EMBEDDED_SECTION_RE);
      if (sectionMatch && sectionMatch.index !== undefined) {
        // Split: part before section header is the actual value, rest is new section(s)
        const actualValue = val.slice(0, sectionMatch.index).trim();
        const sectionContent = val.slice(sectionMatch.index).trim();

        if (actualValue && actualValue.length <= 200) {
          tableRows.push({ key, value: actualValue });
        } else if (actualValue) {
          // Long actual value — try to split into sub-features
          const features = splitEmbeddedFeatures(actualValue);
          if (features.length >= 2) {
            const items = features.map((f, i) => {
              if (i === 0 && !f.key) {
                return `<li><strong>${escHtml(key)}</strong> - ${escHtml(f.value)}</li>`;
              } else if (f.key) {
                return `<li><strong>${escHtml(f.key)}</strong> - ${escHtml(f.value)}</li>`;
              }
              return `<li>${escHtml(f.value)}</li>`;
            });
            extraSections.push(`<ul>\n${items.join('\n')}\n</ul>`);
          } else {
            // Just keep first few sentences
            const sentences = actualValue.split(/(?<=[.!?])\s+/).filter(s => s.trim());
            tableRows.push({ key, value: sentences.slice(0, 3).join(' ') });
          }
        }

        // Process the embedded section content
        const sectionName = sectionMatch[1];
        const sectionBody = sectionContent.replace(EMBEDDED_SECTION_RE, '').trim();
        const normalizedSectionName = normalizeHeading(sectionName);

        if (sectionName.toLowerCase().startsWith('key feature') || sectionName.toLowerCase() === 'features') {
          // Convert to feature list
          const features = splitEmbeddedFeatures(sectionBody);
          if (features.length >= 2) {
            const items = features.map(f => {
              if (f.key) return `<li><strong>${escHtml(f.key)}</strong> - ${escHtml(f.value)}</li>`;
              return `<li>${escHtml(f.value)}</li>`;
            });
            extraSections.push(`<h3>${escHtml(normalizedSectionName)}</h3>\n<ul>\n${items.join('\n')}\n</ul>`);
          } else {
            extraSections.push(`<h3>${escHtml(normalizedSectionName)}</h3>\n<p>${escHtml(sectionBody)}</p>`);
          }
        } else if (sectionName.toLowerCase() === 'measurements') {
          const { measurements } = extractEmbeddedMeasurements(sectionName + ': ' + sectionBody);
          if (measurements.length > 0) {
            measurementSpecs.push(...measurements);
          } else {
            extraSections.push(`<h3>Measurements</h3>\n<p>${escHtml(sectionBody)}</p>`);
          }
        } else if (sectionName.toLowerCase() === 'note') {
          extraSections.push(`<p><strong>Note:</strong> ${escHtml(sectionBody)}</p>`);
        } else {
          extraSections.push(`<h3>${escHtml(normalizedSectionName)}</h3>\n<p>${escHtml(sectionBody)}</p>`);
        }
        continue;
      }

      // No embedded section header
      if (val.length <= 200) {
        tableRows.push({ key, value: val });
        continue;
      }

      // Long value without section headers — extract measurements, then split sub-features
      const { cleanText, measurements } = extractEmbeddedMeasurements(val);
      measurementSpecs.push(...measurements);

      const features = splitEmbeddedFeatures(cleanText);
      if (features.length >= 2) {
        // Convert to a feature list
        const items = features.map((f, i) => {
          if (i === 0 && !f.key) {
            return `<li><strong>${escHtml(key)}</strong> - ${escHtml(f.value)}</li>`;
          } else if (f.key) {
            return `<li><strong>${escHtml(f.key)}</strong> - ${escHtml(f.value)}</li>`;
          }
          return `<li>${escHtml(f.value)}</li>`;
        });
        extraSections.push(`<ul>\n${items.join('\n')}\n</ul>`);
      } else {
        // Just truncate to first few sentences
        const sentences = cleanText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        const summary = sentences.slice(0, 3).join(' ');
        tableRows.push({ key, value: summary });
      }
    }

    // Build output: use original heading for remaining table rows
    let output = '';

    // Feature lists / extracted sections come first
    if (extraSections.length > 0) {
      output += extraSections.join('\n');
    }

    // Short spec rows as a table (with original heading if no extracted sections took it)
    if (tableRows.length > 0) {
      const trs = tableRows.map(r => `<tr><th>${escHtml(r.key)}</th><td>${escHtml(r.value)}</td></tr>`).join('\n');
      // Use the original heading for the remaining table rows
      const heading = origHeading && !output.includes('<h3>') ? origHeading + '\n' : '';
      output += (output ? '\n' : '') + heading + `<table><tbody>\n${trs}\n</tbody></table>`;
    }

    // Extracted measurements as a separate table
    if (measurementSpecs.length > 0) {
      const measRows = measurementSpecs.map(s =>
        `<tr><th>${escHtml(s.key)}</th><td>${escHtml(s.value)}</td></tr>`
      ).join('\n');
      output += `\n<h3>Measurements</h3>\n<table><tbody>\n${measRows}\n</tbody></table>`;
    }

    return output || _match;
  });

  // Find <p> blocks after "Key Features" heading that contain embedded sub-features
  // Convert "Feature Name: description text! Another Feature: more text" into <ul>
  result = result.replace(/(<h3>Key [Ff]eatures<\/h3>\s*)<p>([^<]+)<\/p>/g, (_match, heading: string, content: string) => {
    const decoded = decodeHtmlEntities(content);
    const items = buildFeatureListItems(decoded);
    if (items.length > 0) {
      return `${heading}<ul>\n${items.join('\n')}\n</ul>`;
    }

    return _match; // Couldn't split, keep as-is
  });

  // Convert inline feature paragraphs ("Key features ...") into explicit heading + list.
  result = result.replace(/<p>\s*(Key [Ff]eatures?|Features?)\s*:?\s*([^<]+)<\/p>/g, (_match, headingText: string, body: string) => {
    const heading = normalizeHeading(headingText);
    const decoded = decodeHtmlEntities(body);
    const items = buildFeatureListItems(decoded);
    if (items.length > 0) {
      return `<h3>${escHtml(heading)}</h3>\n<ul>\n${items.join('\n')}\n</ul>`;
    }
    return `<h3>${escHtml(heading)}</h3>\n<p>${escHtml(decoded.trim())}</p>`;
  });

  // Convert measurement/dimension narratives under a heading into spec tables.
  result = result.replace(/(<h3>(Measurements|Dimensions|Product Dimensions)<\/h3>\s*)<p>([^<]+)<\/p>/g, (_match, headingBlock: string, _headingName: string, content: string) => {
    const decoded = decodeHtmlEntities(content);
    const parsed = parseNarrativeSpecs(decoded);
    if (parsed.specs.length === 0) return _match;

    const rows = parsed.specs
      .map((s) => `<tr><th>${escHtml(s.key)}</th><td>${escHtml(s.value)}</td></tr>`)
      .join('\n');
    let out = `${headingBlock}<table><tbody>\n${rows}\n</tbody></table>`;
    if (parsed.remaining) {
      out += `\n<p>${escHtml(parsed.remaining)}</p>`;
    }
    return out;
  });

  // Find <p> blocks that contain concatenated spec-like content
  // and convert them to tables, leaving everything else untouched
  result = result.replace(/<p>([^<]+)<\/p>/g, (_match, content: string) => {
    const decoded = decodeHtmlEntities(content);

    // Check if this paragraph contains spec-like content
    const specChunks = splitGenericSpecs(decoded);
    if (specChunks.length < 3) return _match; // Not enough specs, keep as-is

    const specs: { key: string; value: string }[] = [];
    const remaining: string[] = [];
    for (const chunk of specChunks) {
      const trimmed = chunk.trim().replace(/\.$/, '');
      if (!trimmed) continue;
      const m = trimmed.match(SPEC_LINE_RE);
      if (m && m[2].trim().length <= 120) {
        specs.push({ key: m[1].trim(), value: m[2].trim().replace(/\.$/, '').replace(/,\s*$/, '') });
      } else {
        remaining.push(trimmed);
      }
    }

    if (specs.length < 2) return _match; // Not enough valid specs

    const rows = specs.map(s => `<tr><th>${escHtml(s.key)}</th><td>${escHtml(s.value)}</td></tr>`).join('\n');
    let tableHtml = `<table><tbody>\n${rows}\n</tbody></table>`;
    if (remaining.length > 0) {
      tableHtml += `\n<p>${escHtml(remaining.join('. '))}</p>`;
    }
    return tableHtml;
  });

  return result;
}

// ─── Main formatting function ────────────────────────────────────────────────

function formatDescription(raw: string): string {
  if (!raw || raw.trim().length === 0) return '';

  // If content already has HTML, do targeted fixes (convert spec blobs to tables)
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return reformatExistingHtml(raw);
  }

  let text = raw;

  // 1. Strip trailing categories section
  text = stripTrailingCategories(text);

  // 2. Fix text artifacts
  text = fixTextArtifacts(text);

  // 3. Fix misspellings
  text = fixMisspellings(text);

  // 4. Fix ALL CAPS
  text = fixAllCaps(text);

  // 5-7. Split into sections and convert to HTML
  const sections = splitIntoSections(text);
  const htmlParts = sections.map(s => sectionToHtml(s));

  return htmlParts.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tablesOnly = args.includes('--tables-only');
  const allHtml = args.includes('--all-html');
  const idIdx = args.indexOf('--id');
  const singleId = idIdx !== -1 ? parseInt(args[idIdx + 1], 10) : null;
  const limitIdx = args.indexOf('--limit');
  const hasExplicitLimit = limitIdx !== -1;
  const limit = hasExplicitLimit ? parseInt(args[limitIdx + 1], 10) : (singleId ? 1 : 10);

  const db = await getConnection();

  // Build WHERE clause based on mode
  const whereClause = tablesOnly
    ? `post_type = 'product' AND post_status = 'publish' AND post_content LIKE '%<table>%'`
    : allHtml
    ? `post_type = 'product' AND post_status = 'publish' AND post_content != '' AND post_content LIKE '%<%'`
    : `post_type = 'product' AND post_status = 'publish' AND post_content != '' AND post_content NOT LIKE '%<%'`;

  try {
    // Count total eligible products
    const [countRows] = await db.query<any[]>(
      `SELECT COUNT(*) as cnt FROM wp_posts WHERE ${whereClause}`
    );
    const totalCount = countRows[0].cnt;
    console.log(`📊 Found ${totalCount} products${tablesOnly ? ' with tables' : allHtml ? ' with HTML' : ' with plain-text descriptions'}\n`);

    // Build query
    let query: string;
    let params: any[] = [];
    if (singleId) {
      query = `SELECT ID, post_title, post_content FROM wp_posts WHERE ID = ?`;
      params = [singleId];
    } else {
      query = `SELECT ID, post_title, post_content FROM wp_posts
               WHERE ${whereClause}
               ORDER BY ID ASC`;
      if (!apply || hasExplicitLimit) {
        query += ` LIMIT ?`;
        params = [apply ? limit : limit];
      }
    }

    const [rows] = await db.query<any[]>(query, params);
    console.log(`📝 Processing ${rows.length} products${apply ? ' (APPLYING CHANGES)' : ' (DRY RUN)'}...\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      const { ID, post_title, post_content } = row;
      const formatted = formatDescription(post_content);

      // Skip if no meaningful change
      if (!formatted || formatted === post_content) {
        skipped++;
        continue;
      }

      if (!apply) {
        const isSingle = singleId !== null;
        console.log('═'.repeat(80));
        console.log(`🏷  [${ID}] ${post_title}`);
        console.log('─'.repeat(80));
        console.log('BEFORE:');
        if (isSingle) {
          console.log(post_content);
        } else {
          console.log(post_content.slice(0, 300) + (post_content.length > 300 ? '...' : ''));
        }
        console.log('─'.repeat(40));
        console.log('AFTER:');
        if (isSingle) {
          console.log(formatted);
        } else {
          console.log(formatted.slice(0, 400) + (formatted.length > 400 ? '...' : ''));
        }
        console.log('');
      } else {
        try {
          await db.query('UPDATE wp_posts SET post_content = ? WHERE ID = ?', [formatted, ID]);
          updated++;
          if (updated % 500 === 0) {
            console.log(`  ✅ Updated ${updated} / ${rows.length}...`);
          }
        } catch (err: any) {
          errors++;
          console.error(`  ❌ Error updating product ${ID}: ${err.message}`);
        }
      }
    }

    console.log('\n' + '═'.repeat(80));
    if (apply) {
      console.log(`✅ Done! Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
    } else {
      console.log(`🔍 Dry run complete. ${rows.length} products previewed (${skipped} unchanged).`);
      console.log(`   Run with --apply to write changes to database.`);
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
