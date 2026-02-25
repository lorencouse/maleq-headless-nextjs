import { NextRequest, NextResponse } from 'next/server';
import {
  isSupportedShippingCountry,
  normalizeCountryCode,
} from '@/lib/checkout/shipping-rates';

interface AddressAutocompleteSuggestion {
  id: string;
  label: string;
  line1: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  residential?: string;
  suburb?: string;
  neighbourhood?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  state_district?: string;
  region?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  address?: NominatimAddress;
}

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;

function parseLimit(rawLimit: string | null): number {
  const parsed = Number.parseInt(rawLimit || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function extractLine1(result: NominatimResult): string {
  const address = result.address;
  if (!address) {
    return result.display_name.split(',')[0]?.trim() || '';
  }

  const street =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.path ||
    address.residential ||
    '';
  const houseNumber = address.house_number || '';

  if (street && houseNumber) return `${houseNumber} ${street}`.trim();
  if (street) return street.trim();

  const localArea = address.suburb || address.neighbourhood || '';
  if (localArea) return localArea.trim();

  return result.display_name.split(',')[0]?.trim() || '';
}

function extractCity(address?: NominatimAddress): string {
  if (!address) return '';
  return (
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    ''
  ).trim();
}

function extractState(address?: NominatimAddress): string {
  if (!address) return '';
  return (
    address.state ||
    address.state_district ||
    address.region ||
    ''
  ).trim();
}

function mapSuggestion(
  result: NominatimResult,
  fallbackCountry: string,
): AddressAutocompleteSuggestion {
  const line1 = extractLine1(result);
  const city = extractCity(result.address);
  const state = extractState(result.address);
  const zipCode = (result.address?.postcode || '').trim();
  const country = (
    result.address?.country_code || fallbackCountry
  ).toUpperCase();

  return {
    id: String(result.place_id),
    label: result.display_name,
    line1,
    city,
    state,
    zipCode,
    country,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = (searchParams.get('q') || '').trim();
    const requestedCountry = normalizeCountryCode(searchParams.get('country') || 'US');
    const country = isSupportedShippingCountry(requestedCountry)
      ? requestedCountry
      : 'US';
    const limit = parseLimit(searchParams.get('limit'));

    if (query.length < 3) {
      return NextResponse.json({ suggestions: [] as AddressAutocompleteSuggestion[] });
    }

    const upstreamParams = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      dedupe: '1',
      limit: String(limit),
      countrycodes: country.toLowerCase(),
    });

    const upstreamResponse = await fetch(
      `${NOMINATIM_ENDPOINT}?${upstreamParams.toString()}`,
      {
        method: 'GET',
        headers: {
          // Nominatim usage policy requires a valid identifying user-agent.
          'User-Agent': 'maleq-headless-checkout/1.0 (https://maleq.com)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cache: 'no-store',
      },
    );

    if (!upstreamResponse.ok) {
      console.error(
        '[api/address/autocomplete] Nominatim request failed:',
        upstreamResponse.status,
      );
      return NextResponse.json({ suggestions: [] as AddressAutocompleteSuggestion[] });
    }

    const results = (await upstreamResponse.json()) as NominatimResult[];
    const seen = new Set<string>();
    const suggestions: AddressAutocompleteSuggestion[] = [];

    for (const result of results) {
      const mapped = mapSuggestion(result, country);
      if (!mapped.line1) continue;

      const dedupeKey = `${mapped.line1.toLowerCase()}|${mapped.zipCode.toLowerCase()}|${mapped.country.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      suggestions.push(mapped);
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[api/address/autocomplete] Failed to fetch suggestions:', error);
    return NextResponse.json({ suggestions: [] as AddressAutocompleteSuggestion[] });
  }
}
