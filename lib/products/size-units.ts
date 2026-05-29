/**
 * Metric/imperial conversion + formatting for pa_size values.
 *
 * Only length & volume (and a little weight) are convertible; apparel sizes,
 * pack counts and unrecognized "review" terms are not in SIZE_UNITS and render
 * unchanged. Data is generated from the cleanup map by scripts/gen-size-units.ts.
 *
 * The stored term is the source of truth in its native unit; the non-native
 * side is converted and rounded (snapping volume to common bottle sizes so
 * 3.4 oz ⇄ 100 ml stays clean).
 */
import { SIZE_UNITS, type SizeUnit, type SizeDim } from './size-units-data';

export type UnitSystem = 'imperial' | 'metric';
export { SIZE_UNITS };
export type { SizeUnit, SizeDim };

const ML_PER_OZ = 29.5735;
const MM_PER_IN = 25.4;
const G_PER_OZ = 28.3495;

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Parse a clean measurement string ("8 in", "100 ml", "45mm") as a fallback for
// values not present in SIZE_UNITS (e.g. untouched review terms that are tidy).
function parseRaw(value: string): SizeUnit | null {
  const s = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/[a-z].*[a-z].*[a-z]/.test(s.replace(/(fl|oz|ml|in|cm|mm|ft|liter|litre|gram)/g, ''))) return null; // has stray words
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz$/))) return { dim: 'volume', value: +m[1], unit: 'oz' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*ml$/))) return { dim: 'volume', value: +m[1], unit: 'ml' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:l|liter|litre)$/))) return { dim: 'volume', value: +m[1], unit: 'l' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/))) return { dim: 'length', value: +m[1], unit: 'in' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*cm$/))) return { dim: 'length', value: +m[1], unit: 'cm' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/))) return { dim: 'length', value: +m[1], unit: 'mm' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|foot|feet)$/))) return { dim: 'length', value: +m[1], unit: 'ft' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*g$/))) return { dim: 'weight', value: +m[1], unit: 'g' };
  return null;
}

/** Look up the native measurement for a size value (slug or display name). */
export function getSizeUnit(value: string): SizeUnit | null {
  if (!value) return null;
  if (SIZE_UNITS[value]) return SIZE_UNITS[value];
  const slug = slugify(value);
  if (SIZE_UNITS[slug]) return SIZE_UNITS[slug];
  return parseRaw(value);
}

/** Is this size value convertible between metric & imperial? */
export function isConvertibleSize(value: string): boolean {
  return getSizeUnit(value) !== null;
}

function toBase(u: SizeUnit): number {
  if (u.dim === 'length') return u.value * { in: MM_PER_IN, cm: 10, mm: 1, ft: 304.8 }[u.unit as 'in' | 'cm' | 'mm' | 'ft'];
  if (u.dim === 'volume') return u.value * { oz: ML_PER_OZ, ml: 1, l: 1000 }[u.unit as 'oz' | 'ml' | 'l'];
  return u.value; // weight base = g
}

// trim to at most `dp` decimals, dropping trailing zeros: 8.00 -> "8", 3.40 -> "3.4"
function trim(n: number, dp = 2): string {
  return parseFloat(n.toFixed(dp)).toString();
}

const COMMON_ML = [5, 10, 15, 20, 30, 50, 60, 100, 120, 150, 200, 236, 240, 250, 300, 355, 400, 473, 500, 750, 1000];
function snap(n: number, list: number[], tolPct = 0.04): number | null {
  for (const c of list) if (Math.abs(n - c) / c <= tolPct) return c;
  return null;
}

/**
 * Format a size value in the requested unit system. Returns the converted/rounded
 * string for convertible length/volume/weight values, or null if not convertible
 * (caller should fall back to its own formatted label).
 */
export function formatSizeValue(value: string, system: UnitSystem): string | null {
  const u = getSizeUnit(value);
  if (!u) return null;

  // When the native unit already matches the requested system we echo the
  // original value verbatim (no float noise); otherwise we convert from base.
  const base = toBase(u);

  if (u.dim === 'length') {
    if (system === 'imperial') {
      if (u.unit === 'in') return `${trim(u.value)} in`;
      if (u.unit === 'ft') return `${trim(u.value)} ft`;
      return `${trim(base / MM_PER_IN, 1)} in`;
    }
    // metric -> mm (tiny) / cm / m (large)
    const mm = base;
    if (mm < 10) return `${trim(mm, 1)} mm`;
    if (mm >= 1000) return `${trim(mm / 1000, 2)} m`;
    return `${trim(mm / 10, 1)} cm`;
  }

  if (u.dim === 'volume') {
    if (system === 'imperial') {
      if (u.unit === 'oz') return `${trim(u.value)} fl oz`;
      return `${trim(base / ML_PER_OZ, 1)} fl oz`;
    }
    // metric -> ml, snapping to common bottle sizes; L when large
    let ml = base;
    const snapped = snap(ml, COMMON_ML);
    if (snapped != null) ml = snapped;
    if (ml >= 1000) return `${trim(ml / 1000, 2)} L`;
    return `${trim(Math.round(ml * 10) / 10, 1)} ml`;
  }

  // weight
  if (system === 'imperial') return `${trim(base / G_PER_OZ, 2)} oz`;
  return `${trim(base, 2)} g`;
}

/** Format showing both systems, e.g. "100 ml (3.4 fl oz)". */
export function formatSizeBoth(value: string, primary: UnitSystem): string | null {
  const p = formatSizeValue(value, primary);
  if (!p) return null;
  const other = formatSizeValue(value, primary === 'imperial' ? 'metric' : 'imperial');
  return other && other !== p ? `${p} (${other})` : p;
}
