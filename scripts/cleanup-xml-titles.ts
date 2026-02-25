/**
 * Cleanup Feed Titles Script
 * Removes junk () patterns from product names/descriptions in XML and CSV feed files.
 * Reuses the same patterns from cleanup-titles.ts (DB version).
 *
 * Usage:
 *   bun run scripts/cleanup-xml-titles.ts --dry-run     # Preview changes
 *   bun run scripts/cleanup-xml-titles.ts --apply        # Apply changes (overwrites files)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ==================== JUNK PATTERNS TO REMOVE ====================

// Exact match patterns (case-insensitive)
const JUNK_PATTERNS_EXACT = [
  // Distributor codes
  '(a)',
  '(d)',
  '(wd)',
  '(cd)',
  '(bu)',
  '(net)',
  '(com)',
  '(ea)',
  '(each)',
  '(free)',

  // Inventory/order markers
  '(bulk)',
  '(bulk only)',
  '(eaches)',
  '(boxed)',
  '(packaged)',
  '(disc)',
  '(asst)',
  '(non-retail, bulk packaging)',

  // Packaging notes
  '(w/ retail box)',
  '(w/o retail box)',
  '(garment only - no box)',
  '(box packaging)',
  '(bag)',
  '(hanging)',

  // Display/sample markers
  '(display sample product only)',

  // Special order markers
  '(special order)',

  // Distributor product line names (not useful in product titles)
  '(cheap thrills)',
  '(liquid onyx)',
  '(luv lace)',
  '(red diamond)',
  '(bedroom fantasy)',
  '(sapphire shimmer)',
  '(champagne lace)',
  '(neon lace)',
  '(party girl)',
  '(bands of lace)',
  '(bamboo)',
  '(o.m.g-strings)',
];

// Regex patterns (case-insensitive)
const JUNK_PATTERN_REGEXES = [
  // Stock status patterns like "(out Beg Dec)", "(out Until July)"
  /\(out\s+(?:beg|until|mid)?\s*\w+\)/gi,

  // Customer limit patterns like "(5 Per Customer)", "(max 10)", "(5 MAX)"
  /\(\d+\s*(?:per|pc|pcs)?\s*(?:per)?\s*cust(?:omer)?\.?\)/gi,
  /\(max\s*\d+\)/gi,
  /\(\d+\s*max\)/gi,
  /\(\s*\d+\s*per\s*cust\.?\s*\)/gi,

  // Quantity patterns that are ordering info
  /\(\d+\s*(?:box|per pop display|per display)\)/gi,
  /\(\d+\s*of\s*each\s*product\)/gi,

  // Long descriptive junk
  /\(bam gee plus[^)]*\)/gi,
  /\(izzy roq roco[^)]*\)/gi,

  // Misc distributor notes
  /\((?:non vibrating|clit clamp included|for vaginal or anal use|wavy line mesh)\)/gi,
  /\((?:the heart nosed one|pointy tongued one|eggplant to taco)\)/gi,
  /\((?:spanish|bass|treble)\)/gi,
  /\((?:universal cuffs|peekaboos)\)/gi,

  // STC reference codes like "(goes W/soh31549)"
  /\(goes\s+w\/\w+\)/gi,

  // Pasties/accessory not included notes in titles
  /\((?:pasties|g-string)\s+not\s+included\)/gi,
];

// ==================== CLEANUP LOGIC ====================

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CleanupResult {
  original: string;
  cleaned: string;
  patternsRemoved: string[];
}

function cleanupText(text: string): CleanupResult {
  let cleaned = text;
  const patternsRemoved: string[] = [];

  // Remove exact match patterns (case-insensitive)
  for (const pattern of JUNK_PATTERNS_EXACT) {
    const regex = new RegExp(escapeRegex(pattern), 'gi');
    const matches = cleaned.match(regex);
    if (matches) {
      patternsRemoved.push(...matches);
      cleaned = cleaned.replace(regex, '');
    }
  }

  // Remove regex patterns
  for (const regex of JUNK_PATTERN_REGEXES) {
    // Reset lastIndex for global regexes
    regex.lastIndex = 0;
    const matches = cleaned.match(regex);
    if (matches) {
      patternsRemoved.push(...matches);
      regex.lastIndex = 0;
      cleaned = cleaned.replace(regex, '');
    }
  }

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  // Remove trailing hyphens/dashes left over
  cleaned = cleaned.replace(/[\s\-–—]+$/g, '').trim();

  return { original: text, cleaned, patternsRemoved };
}

// ==================== XML PROCESSING ====================

const XML_FILES = [
  'data/products-filtered.xml',
  'data/inactive_products.xml',
];

const CSV_FILES = [
  'data/stc-product-feed.csv',
];

// Fields inside <name> and <description> CDATA blocks
const CDATA_TAG_REGEX = /<(name|description)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g;

function processXmlContent(content: string): { result: string; changes: { file?: string; tag: string; before: string; after: string; removed: string[] }[] } {
  const changes: { tag: string; before: string; after: string; removed: string[] }[] = [];

  const result = content.replace(CDATA_TAG_REGEX, (match, tag, text) => {
    const cleanup = cleanupText(text);
    if (cleanup.patternsRemoved.length > 0) {
      changes.push({
        tag,
        before: cleanup.original.trim().slice(0, 120),
        after: cleanup.cleaned.slice(0, 120),
        removed: cleanup.patternsRemoved,
      });
      return `<${tag}><![CDATA[${cleanup.cleaned}]]></${tag}>`;
    }
    return match;
  });

  return { result, changes };
}

// ==================== CSV PROCESSING ====================

// CSV column indices (0-based): 2 = Product Name, 3 = Description
const CSV_NAME_COL = 2;
const CSV_DESC_COL = 3;

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function rebuildCSVLine(fields: string[]): string {
  return fields.map(field => {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
  }).join(',');
}

interface CSVChange {
  row: number;
  col: string;
  before: string;
  after: string;
  removed: string[];
}

function processCSVContent(content: string): { result: string; changes: CSVChange[] } {
  const lines = content.split('\n');
  const changes: CSVChange[] = [];
  const outputLines: string[] = [lines[0]]; // keep header

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      outputLines.push(line);
      continue;
    }

    const fields = parseCSVLine(line);
    let changed = false;

    // Clean Product Name (col 2)
    if (fields[CSV_NAME_COL]) {
      const result = cleanupText(fields[CSV_NAME_COL]);
      if (result.patternsRemoved.length > 0) {
        changes.push({
          row: i + 1,
          col: 'name',
          before: result.original.slice(0, 120),
          after: result.cleaned.slice(0, 120),
          removed: result.patternsRemoved,
        });
        fields[CSV_NAME_COL] = result.cleaned;
        changed = true;
      }
    }

    // Clean Description (col 3)
    if (fields[CSV_DESC_COL]) {
      const result = cleanupText(fields[CSV_DESC_COL]);
      if (result.patternsRemoved.length > 0) {
        changes.push({
          row: i + 1,
          col: 'description',
          before: result.original.slice(0, 120),
          after: result.cleaned.slice(0, 120),
          removed: result.patternsRemoved,
        });
        fields[CSV_DESC_COL] = result.cleaned;
        changed = true;
      }
    }

    outputLines.push(changed ? rebuildCSVLine(fields) : line);
  }

  return { result: outputLines.join('\n'), changes };
}

// ==================== COMMANDS ====================

function processFile(file: string, apply: boolean): { nameChanges: number; descChanges: number } {
  const filePath = resolve(process.cwd(), file);
  const isCSV = file.endsWith('.csv');

  console.log(`\nProcessing: ${file}`);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    console.log(`  SKIPPED - file not found`);
    return { nameChanges: 0, descChanges: 0 };
  }

  let changes: { col?: string; tag?: string; before: string; after: string; removed: string[] }[];
  let result: string;

  if (isCSV) {
    const processed = processCSVContent(content);
    changes = processed.changes;
    result = processed.result;
  } else {
    const processed = processXmlContent(content);
    changes = processed.changes;
    result = processed.result;
  }

  const nameKey = isCSV ? 'col' : 'tag';
  const nameVal = isCSV ? 'name' : 'name';
  const descVal = isCSV ? 'description' : 'description';

  const nameChanges = changes.filter(c => (c as any)[nameKey] === nameVal);
  const descChanges = changes.filter(c => (c as any)[nameKey] === descVal);

  console.log(`  Name changes: ${nameChanges.length}`);
  console.log(`  Description changes: ${descChanges.length}`);

  if (!apply) {
    // Show sample name changes
    if (nameChanges.length > 0) {
      console.log('\n  Sample NAME changes:');
      for (const change of nameChanges.slice(0, 20)) {
        console.log(`    BEFORE: ${change.before}`);
        console.log(`    AFTER:  ${change.after}`);
        console.log(`    REMOVED: ${change.removed.join(', ')}`);
        console.log('');
      }
      if (nameChanges.length > 20) {
        console.log(`    ... and ${nameChanges.length - 20} more name changes\n`);
      }
    }

    if (descChanges.length > 0) {
      console.log(`  Sample DESCRIPTION changes (${descChanges.length} total):`);
      for (const change of descChanges.slice(0, 5)) {
        console.log(`    REMOVED: ${change.removed.join(', ')}`);
      }
      console.log('');
    }
  } else if (changes.length > 0) {
    writeFileSync(filePath, result, 'utf-8');
    console.log(`  Written! Names: ${nameChanges.length}, Descriptions: ${descChanges.length}`);
  } else {
    console.log(`  No changes needed`);
  }

  return { nameChanges: nameChanges.length, descChanges: descChanges.length };
}

function runDryRun(): void {
  console.log('DRY RUN - Preview changes without applying\n');

  let totalNameChanges = 0;
  let totalDescChanges = 0;

  for (const file of [...XML_FILES, ...CSV_FILES]) {
    const { nameChanges, descChanges } = processFile(file, false);
    totalNameChanges += nameChanges;
    totalDescChanges += descChanges;
  }

  console.log('\n========================================');
  console.log('              SUMMARY');
  console.log('========================================');
  console.log(`Total name changes: ${totalNameChanges}`);
  console.log(`Total description changes: ${totalDescChanges}`);
  console.log(`Total: ${totalNameChanges + totalDescChanges}`);
  console.log('\nRun with --apply to write changes to files');
}

function runApply(): void {
  console.log('APPLYING CHANGES to feed files\n');

  let totalNameChanges = 0;
  let totalDescChanges = 0;

  for (const file of [...XML_FILES, ...CSV_FILES]) {
    const { nameChanges, descChanges } = processFile(file, true);
    totalNameChanges += nameChanges;
    totalDescChanges += descChanges;
  }

  console.log('\n========================================');
  console.log('           APPLY COMPLETE');
  console.log('========================================');
  console.log(`Total name changes: ${totalNameChanges}`);
  console.log(`Total description changes: ${totalDescChanges}`);
  console.log(`Total: ${totalNameChanges + totalDescChanges}`);
}

// ==================== MAIN ====================

const args = process.argv.slice(2);
const command = args[0] || '--dry-run';

console.log('XML Title Cleanup - Remove junk () patterns from XML feed files\n');

switch (command) {
  case '--dry-run':
    runDryRun();
    break;
  case '--apply':
    runApply();
    break;
  default:
    console.log('Usage:');
    console.log('  bun run scripts/cleanup-xml-titles.ts --dry-run   # Preview changes');
    console.log('  bun run scripts/cleanup-xml-titles.ts --apply     # Apply to files');
}
