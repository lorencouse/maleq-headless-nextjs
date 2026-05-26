import { FREE_SHIPPING_THRESHOLD } from '@/lib/utils/cart-helpers';

type DeliveryEstimate = {
  minimum: { unit: 'business_day'; value: number };
  maximum: { unit: 'business_day'; value: number };
};

export type ShippingRegion = 'domestic' | 'international';

export interface ShippingOption {
  id: string;
  name: string;
  description: string;
  price: number;
  freeThreshold: number | null;
  deliveryEstimate: DeliveryEstimate;
}

const DOMESTIC_OPTIONS: ShippingOption[] = [
  {
    id: 'standard',
    name: 'Standard Shipping',
    description: '5-7 business days',
    price: 7.99,
    freeThreshold: FREE_SHIPPING_THRESHOLD,
    deliveryEstimate: {
      minimum: { unit: 'business_day', value: 5 },
      maximum: { unit: 'business_day', value: 7 },
    },
  },
  {
    id: 'express',
    name: 'Express Shipping',
    description: '2-3 business days',
    price: 14.99,
    freeThreshold: null,
    deliveryEstimate: {
      minimum: { unit: 'business_day', value: 2 },
      maximum: { unit: 'business_day', value: 3 },
    },
  },
];

const INTERNATIONAL_OPTIONS: ShippingOption[] = [
  {
    id: 'intl-standard',
    name: 'International Standard',
    description: '6-12 business days',
    price: 14.99,
    freeThreshold: null,
    deliveryEstimate: {
      minimum: { unit: 'business_day', value: 6 },
      maximum: { unit: 'business_day', value: 12 },
    },
  },
  {
    id: 'intl-priority',
    name: 'International Priority',
    description: '3-6 business days',
    price: 29.99,
    freeThreshold: null,
    deliveryEstimate: {
      minimum: { unit: 'business_day', value: 3 },
      maximum: { unit: 'business_day', value: 6 },
    },
  },
];

// Countries we currently ship to. Selected for low payment-fraud risk and
// unambiguous legal status for adult-product import. Other countries appear
// in the checkout country selector but fail validation server-side
// (UNSUPPORTED_COUNTRY in server-pricing.ts).
export const SHIPPING_COUNTRY_OPTIONS = [
  // North America
  { code: 'US', name: 'United States' },
  // US territories — shipped via USPS at domestic rates (see DOMESTIC_SHIPPING_COUNTRY_SET)
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'Virgin Islands (U.S.)' },
  { code: 'GU', name: 'Guam' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'UM', name: 'United States Minor Outlying Islands' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  // British Isles
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  // Nordics
  { code: 'IS', name: 'Iceland' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'SE', name: 'Sweden' },
  { code: 'FI', name: 'Finland' },
  // Western Europe
  { code: 'DE', name: 'Germany' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'FR', name: 'France' },
  { code: 'MC', name: 'Monaco' },
  // Southern Europe
  { code: 'ES', name: 'Spain' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italy' },
  { code: 'MT', name: 'Malta' },
  { code: 'GR', name: 'Greece' },
  { code: 'CY', name: 'Cyprus' },
  // Central / Eastern Europe (EU)
  { code: 'CZ', name: 'Czechia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'PL', name: 'Poland' },
  { code: 'HU', name: 'Hungary' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'HR', name: 'Croatia' },
  { code: 'EE', name: 'Estonia' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'RO', name: 'Romania' },
  // Oceania
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  // Developed Asia
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'Korea (South)' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'IL', name: 'Israel' },
] as const;

export const SUPPORTED_SHIPPING_COUNTRIES = SHIPPING_COUNTRY_OPTIONS.map(
  (country) => country.code
);
const SUPPORTED_SHIPPING_COUNTRY_SET = new Set<string>(SUPPORTED_SHIPPING_COUNTRIES);

// US + US territories — all reachable via USPS at domestic rates.
const DOMESTIC_SHIPPING_COUNTRY_SET = new Set<string>([
  'US', 'PR', 'VI', 'GU', 'MP', 'AS', 'UM',
]);

export function normalizeCountryCode(countryCode?: string): string {
  return (countryCode || 'US').toUpperCase();
}

export function isDomesticShippingCountry(countryCode?: string): boolean {
  return DOMESTIC_SHIPPING_COUNTRY_SET.has(normalizeCountryCode(countryCode));
}

export function isSupportedShippingCountry(countryCode?: string): boolean {
  return SUPPORTED_SHIPPING_COUNTRY_SET.has(normalizeCountryCode(countryCode));
}

export function getShippingRegion(countryCode?: string): ShippingRegion {
  return isDomesticShippingCountry(countryCode) ? 'domestic' : 'international';
}

export function getShippingOptions(countryCode?: string): ShippingOption[] {
  return getShippingRegion(countryCode) === 'domestic'
    ? DOMESTIC_OPTIONS
    : INTERNATIONAL_OPTIONS;
}

export function getShippingPrice(option: ShippingOption, subtotal: number): number {
  if (option.freeThreshold !== null && subtotal >= option.freeThreshold) {
    return 0;
  }

  return option.price;
}

export function getStripeShippingRates(subtotal: number, countryCode?: string) {
  return getShippingOptions(countryCode).map((option) => ({
    id: option.id,
    displayName: option.name,
    amount: Math.round(getShippingPrice(option, subtotal) * 100),
    deliveryEstimate: option.deliveryEstimate,
  }));
}
