/**
 * Tax Calculator Utility
 *
 * Calculates sales tax based on shipping state.
 * In a production environment, this would integrate with a tax service
 * like TaxJar, Avalara, or use WooCommerce's tax settings.
 */

// US State tax rates (simplified - actual rates vary by locality)
// These are approximate state-level rates as of 2024
const STATE_TAX_RATES: Record<string, number> = {
  AL: 0.04,
  AK: 0.0, // No state sales tax
  AZ: 0.056,
  AR: 0.065,
  CA: 0.0725,
  CO: 0.029,
  CT: 0.0635,
  DE: 0.0, // No state sales tax
  FL: 0.06,
  GA: 0.04,
  HI: 0.04,
  ID: 0.06,
  IL: 0.0625,
  IN: 0.07,
  IA: 0.06,
  KS: 0.065,
  KY: 0.06,
  LA: 0.0445,
  ME: 0.055,
  MD: 0.06,
  MA: 0.0625,
  MI: 0.06,
  MN: 0.06875,
  MS: 0.07,
  MO: 0.04225,
  MT: 0.0, // No state sales tax
  NE: 0.055,
  NV: 0.0685,
  NH: 0.0, // No state sales tax
  NJ: 0.06625,
  NM: 0.05125,
  NY: 0.04,
  NC: 0.0475,
  ND: 0.05,
  OH: 0.0575,
  OK: 0.045,
  OR: 0.0, // No state sales tax
  PA: 0.06,
  RI: 0.07,
  SC: 0.06,
  SD: 0.045,
  TN: 0.07,
  TX: 0.0625,
  UT: 0.0485,
  VT: 0.06,
  VA: 0.053,
  WA: 0.065,
  WV: 0.06,
  WI: 0.05,
  WY: 0.04,
};

// States with no sales tax
export const NO_TAX_STATES = ['AK', 'DE', 'MT', 'NH', 'OR'];

export interface TaxCalculationResult {
  taxRate: number;
  taxAmount: number;
  taxableAmount: number;
  stateName: string;
  stateCode: string;
}

/**
 * Get the tax rate for a given state
 */
export function getStateTaxRate(stateCode: string): number {
  const code = stateCode.toUpperCase();
  return STATE_TAX_RATES[code] ?? 0;
}

/**
 * Check if a state has sales tax
 */
export function stateHasSalesTax(stateCode: string): boolean {
  return !NO_TAX_STATES.includes(stateCode.toUpperCase());
}

/**
 * Calculate tax for an order
 *
 * @param subtotal - Cart subtotal (before shipping)
 * @param shipping - Shipping cost
 * @param stateCode - Two-letter state code
 * @param includeShippingInTax - Whether to tax shipping (varies by state)
 */
export function calculateTax(
  subtotal: number,
  shipping: number,
  stateCode: string,
  includeShippingInTax: boolean = false
): TaxCalculationResult {
  const code = stateCode.toUpperCase();
  const taxRate = getStateTaxRate(code);

  // Determine taxable amount
  // Some states tax shipping, others don't
  const taxableAmount = includeShippingInTax ? subtotal + shipping : subtotal;

  const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100;

  return {
    taxRate,
    taxAmount,
    taxableAmount,
    stateName: getStateName(code),
    stateCode: code,
  };
}

/**
 * Get state name from code
 */
function getStateName(stateCode: string): string {
  const stateNames: Record<string, string> = {
    AL: 'Alabama',
    AK: 'Alaska',
    AZ: 'Arizona',
    AR: 'Arkansas',
    CA: 'California',
    CO: 'Colorado',
    CT: 'Connecticut',
    DE: 'Delaware',
    FL: 'Florida',
    GA: 'Georgia',
    HI: 'Hawaii',
    ID: 'Idaho',
    IL: 'Illinois',
    IN: 'Indiana',
    IA: 'Iowa',
    KS: 'Kansas',
    KY: 'Kentucky',
    LA: 'Louisiana',
    ME: 'Maine',
    MD: 'Maryland',
    MA: 'Massachusetts',
    MI: 'Michigan',
    MN: 'Minnesota',
    MS: 'Mississippi',
    MO: 'Missouri',
    MT: 'Montana',
    NE: 'Nebraska',
    NV: 'Nevada',
    NH: 'New Hampshire',
    NJ: 'New Jersey',
    NM: 'New Mexico',
    NY: 'New York',
    NC: 'North Carolina',
    ND: 'North Dakota',
    OH: 'Ohio',
    OK: 'Oklahoma',
    OR: 'Oregon',
    PA: 'Pennsylvania',
    RI: 'Rhode Island',
    SC: 'South Carolina',
    SD: 'South Dakota',
    TN: 'Tennessee',
    TX: 'Texas',
    UT: 'Utah',
    VT: 'Vermont',
    VA: 'Virginia',
    WA: 'Washington',
    WV: 'West Virginia',
    WI: 'Wisconsin',
    WY: 'Wyoming',
  };

  return stateNames[stateCode] || stateCode;
}

/**
 * Format tax rate as percentage string
 */
export function formatTaxRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
