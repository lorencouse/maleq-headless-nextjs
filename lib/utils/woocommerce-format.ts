/**
 * Utility functions for formatting WooCommerce data for display
 */

/**
 * Format WooCommerce attribute name for display
 * Removes 'pa_' prefix and converts to title case
 * e.g., "pa_size" → "Size", "pa_color" → "Color"
 */
export function formatAttributeName(name: string): string {
  if (!name) return '';

  // Remove 'pa_' prefix if present
  let formatted = name.replace(/^pa_/, '');

  // Replace underscores and hyphens with spaces
  formatted = formatted.replace(/[_-]/g, ' ');

  // Convert to title case
  return formatted
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format WooCommerce attribute value (slug) for display
 * Converts slugified values to human-readable format
 * e.g., "100-ml" → "100 ml", "extra-large" → "Extra Large"
 */
export function formatAttributeValue(value: string): string {
  if (!value) return '';

  // Replace hyphens with spaces
  let formatted = value.replace(/-/g, ' ');

  // Check if it starts with a number (like "100 ml", "2 oz")
  const startsWithNumber = /^\d/.test(formatted);

  if (startsWithNumber) {
    // For values like "100 ml", just clean up spacing
    // Make sure units are lowercase
    return formatted.replace(/\s+/g, ' ').trim();
  }

  // For text values, convert to title case
  return formatted
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format price from WooCommerce format
 * Handles various formats: "$82.35", "82.35", "$82.35 - $99.99"
 */
export function formatPrice(price: string | null | undefined): string {
  if (!price) return 'N/A';

  // If it's already formatted with $, clean it up and return
  if (price.includes('$')) {
    // Handle range prices like "$82.35 - $99.99"
    if (price.includes('-')) {
      return price.trim();
    }
    return price.trim();
  }

  // Try to parse as number
  const num = parseFloat(price.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return 'N/A';

  return `$${num.toFixed(2)}`;
}

/**
 * Parse price string to number
 * Handles WooCommerce price formats
 */
export function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;

  // Remove currency symbols and any non-numeric characters except decimal
  const cleaned = price.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);

  return isNaN(num) ? 0 : num;
}

/**
 * Calculate the percentage discount between regular and sale price
 * Returns the percentage off as a whole number (e.g., 20 for 20% off)
 * Returns null if calculation is not possible or prices are invalid
 */
export function calculatePercentOff(
  regularPrice: string | null | undefined,
  salePrice: string | null | undefined
): number | null {
  const regular = parsePrice(regularPrice);
  const sale = parsePrice(salePrice);

  // Validate prices
  if (regular <= 0 || sale <= 0 || sale >= regular) {
    return null;
  }

  // Calculate percentage off and round to nearest whole number
  const percentOff = Math.round(((regular - sale) / regular) * 100);

  // Only return if discount is meaningful (at least 1%)
  return percentOff >= 1 ? percentOff : null;
}

/**
 * Format a variation name for display
 * Cleans up WooCommerce variation names which often include raw attribute values
 */
export function formatVariationName(
  parentName: string,
  attributes: Array<{ name: string; value: string }>
): string {
  if (!attributes || attributes.length === 0) {
    return parentName;
  }

  const formattedAttrs = attributes
    .map(attr => formatAttributeValue(attr.value))
    .join(' - ');

  return `${parentName} - ${formattedAttrs}`;
}
