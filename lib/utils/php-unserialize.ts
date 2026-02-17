/**
 * Minimal PHP unserialize parser for WooCommerce _product_attributes meta.
 *
 * Handles: a: (array), s: (string), i: (integer), b: (boolean), d: (double), N; (null)
 * Does NOT handle: objects (O:), references (R:), or custom serializers.
 */

type PHPValue = string | number | boolean | null | { [key: string]: PHPValue };
type PHPArray = { [key: string]: PHPValue };

interface ParseResult {
  value: PHPValue;
  offset: number;
}

function parseString(data: string, offset: number): ParseResult {
  // s:LENGTH:"VALUE";
  const colonIdx = data.indexOf(':', offset + 2);
  const len = parseInt(data.substring(offset + 2, colonIdx), 10);
  // Skip past :" to get to the value
  const start = colonIdx + 2; // skip :"
  const value = data.substring(start, start + len);
  // Skip past ";
  return { value, offset: start + len + 2 };
}

function parseInt_(data: string, offset: number): ParseResult {
  // i:VALUE;
  const end = data.indexOf(';', offset + 2);
  const value = parseInt(data.substring(offset + 2, end), 10);
  return { value, offset: end + 1 };
}

function parseDouble(data: string, offset: number): ParseResult {
  // d:VALUE;
  const end = data.indexOf(';', offset + 2);
  const value = parseFloat(data.substring(offset + 2, end));
  return { value, offset: end + 1 };
}

function parseBool(data: string, offset: number): ParseResult {
  // b:0; or b:1;
  const value = data[offset + 2] === '1';
  return { value, offset: offset + 4 };
}

function parseNull(_data: string, offset: number): ParseResult {
  // N;
  return { value: null, offset: offset + 2 };
}

function parseArray(data: string, offset: number): ParseResult {
  // a:COUNT:{...}
  const colonIdx = data.indexOf(':', offset + 2);
  const count = parseInt(data.substring(offset + 2, colonIdx), 10);
  let pos = colonIdx + 2; // skip :{

  const result: PHPArray = {};

  for (let i = 0; i < count; i++) {
    // Parse key (string or int)
    const keyResult = parseValue(data, pos);
    pos = keyResult.offset;
    const key = String(keyResult.value);

    // Parse value
    const valResult = parseValue(data, pos);
    pos = valResult.offset;
    result[key] = valResult.value;
  }

  // Skip closing }
  return { value: result, offset: pos + 1 };
}

function parseValue(data: string, offset: number): ParseResult {
  const type = data[offset];

  switch (type) {
    case 's': return parseString(data, offset);
    case 'i': return parseInt_(data, offset);
    case 'd': return parseDouble(data, offset);
    case 'b': return parseBool(data, offset);
    case 'N': return parseNull(data, offset);
    case 'a': return parseArray(data, offset);
    default:
      throw new Error(`Unsupported PHP serialize type '${type}' at offset ${offset}`);
  }
}

/**
 * Unserialize a PHP serialized string.
 * Returns the parsed value, or null if parsing fails.
 */
export function phpUnserialize(data: string): PHPValue {
  if (!data || typeof data !== 'string') return null;
  try {
    const result = parseValue(data, 0);
    return result.value;
  } catch {
    return null;
  }
}

/**
 * Parse WooCommerce _product_attributes meta into a usable format.
 *
 * Input format (PHP serialized):
 * a:N:{s:LEN:"pa_color";a:6:{s:4:"name";s:8:"pa_color";s:5:"value";s:9:"Red | Blue";...}}
 *
 * Output: Array of parsed attributes with name, value (pipe-separated options), visibility, variation flags.
 */
export interface ParsedAttribute {
  name: string;
  value: string;       // pipe or comma separated options string
  position: number;
  isVisible: boolean;
  isVariation: boolean;
  isTaxonomy: boolean;
}

export function parseProductAttributes(serialized: string): ParsedAttribute[] {
  const parsed = phpUnserialize(serialized);
  if (!parsed || typeof parsed !== 'object') return [];

  const attrs: ParsedAttribute[] = [];

  for (const [, attrData] of Object.entries(parsed as PHPArray)) {
    if (!attrData || typeof attrData !== 'object') continue;
    const a = attrData as PHPArray;

    attrs.push({
      name: String(a.name || ''),
      value: String(a.value || ''),
      position: Number(a.position || 0),
      isVisible: a.is_visible === 1 || a.is_visible === true,
      isVariation: a.is_variation === 1 || a.is_variation === true,
      isTaxonomy: a.is_taxonomy === 1 || a.is_taxonomy === true,
    });
  }

  return attrs.sort((a, b) => a.position - b.position);
}
