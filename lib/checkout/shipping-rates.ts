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
  {
    id: 'overnight',
    name: 'Overnight Shipping',
    description: 'Next business day',
    price: 24.99,
    freeThreshold: null,
    deliveryEstimate: {
      minimum: { unit: 'business_day', value: 1 },
      maximum: { unit: 'business_day', value: 1 },
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

export const SHIPPING_COUNTRY_OPTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'DK', name: 'Denmark' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
] as const;

export const SUPPORTED_SHIPPING_COUNTRIES = SHIPPING_COUNTRY_OPTIONS.map(
  (country) => country.code
);
const SUPPORTED_SHIPPING_COUNTRY_SET = new Set<string>(SUPPORTED_SHIPPING_COUNTRIES);

export function normalizeCountryCode(countryCode?: string): string {
  return (countryCode || 'US').toUpperCase();
}

export function isDomesticShippingCountry(countryCode?: string): boolean {
  return normalizeCountryCode(countryCode) === 'US';
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
