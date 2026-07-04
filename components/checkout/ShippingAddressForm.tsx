'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCheckoutStore } from '@/lib/store/checkout-store';
import {
  isSupportedShippingCountry,
  isDomesticShippingCountry,
} from '@/lib/checkout/shipping-rates';
import {
  getCountryName,
  getLocalizedCountries,
  getLocalizedCountryName,
} from '@/lib/data/countries';

// Map the app locale to the BCP-47 tag Intl.DisplayNames expects (the two
// Chinese variants need the script subtag to resolve Simplified vs Traditional).
const INTL_LOCALE: Record<string, string> = { zh: 'zh-Hans', 'zh-hant': 'zh-Hant' };

// US States for dropdown
const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

interface AddressSuggestion {
  id: string;
  label: string;
  line1: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

const US_STATE_LOOKUP = new Map<string, string>(
  US_STATES.flatMap((entry) => [
    [entry.code.toLowerCase(), entry.code],
    [entry.name.toLowerCase(), entry.code],
  ]),
);

interface ShippingAddress {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export default function ShippingAddressForm() {
  const t = useTranslations('checkout.shippingAddress');
  const { user, token } = useAuthStore();
  const setCheckoutAddress = useCheckoutStore((state) => state.setShippingAddress);
  const [address, setAddress] = useState<ShippingAddress>({
    firstName: '',
    lastName: '',
    company: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isAutocompleteLoading, setIsAutocompleteLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hasAutocompleteError, setHasAutocompleteError] = useState(false);
  const [isAddressInputFocused, setIsAddressInputFocused] = useState(false);
  const skipAutocompleteRef = useRef(false);
  const hideSuggestionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUSAddress = address.country === 'US';
  const usesZipCode = isDomesticShippingCountry(address.country);

  const [countryQuery, setCountryQuery] = useState('');
  const [isCountryFocused, setIsCountryFocused] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const hideCountryDropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = useLocale();
  const intlLocale = INTL_LOCALE[locale] ?? locale;
  // Country names localized via Intl.DisplayNames (CLDR), sorted per-locale.
  const localizedCountries = useMemo(
    () => getLocalizedCountries(intlLocale),
    [intlLocale],
  );

  const isCountrySupported = isSupportedShippingCountry(address.country);
  const selectedCountryName = getLocalizedCountryName(address.country, intlLocale);
  const countryInputValue = isCountryFocused ? countryQuery : selectedCountryName;
  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return localizedCountries;
    return localizedCountries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        // Also match the English name so typing in English works on any locale.
        getCountryName(c.code).toLowerCase().includes(q),
    );
  }, [countryQuery, localizedCountries]);

  // Auto-populate from saved customer addresses
  useEffect(() => {
    if (!user?.id || !token) return;

    fetch(`/api/customers/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        // Prefer shipping address, fall back to billing
        const addr = data.shipping?.address_1 ? data.shipping : data.billing;
        if (addr?.address_1) {
          setAddress({
            firstName: addr.first_name || user.firstName || '',
            lastName: addr.last_name || user.lastName || '',
            company: addr.company || '',
            address1: addr.address_1 || '',
            address2: addr.address_2 || '',
            city: addr.city || '',
            state: addr.state || '',
            zipCode: addr.postcode || '',
            country: addr.country || 'US',
          });
        } else if (user.firstName || user.lastName) {
          // At minimum, fill in the name
          setAddress((prev) => ({
            ...prev,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
          }));
        }
      })
      .catch(() => {});
  }, [user?.firstName, user?.id, user?.lastName, token]);

  // Sync local address to checkout store whenever it changes
  useEffect(() => {
    setCheckoutAddress(address);
  }, [address, setCheckoutAddress]);

  useEffect(() => {
    return () => {
      if (hideSuggestionsTimerRef.current) {
        clearTimeout(hideSuggestionsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAddressInputFocused) return;

    if (skipAutocompleteRef.current) {
      skipAutocompleteRef.current = false;
      return;
    }

    const query = address.address1.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsAutocompleteLoading(false);
      setHasAutocompleteError(false);
      return;
    }

    const controller = new AbortController();
    const timerId = setTimeout(async () => {
      try {
        setIsAutocompleteLoading(true);
        setHasAutocompleteError(false);

        const params = new URLSearchParams({
          q: query,
          country: address.country || 'US',
          limit: '5',
        });
        const response = await fetch(`/api/address/autocomplete?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to fetch address suggestions');
        }

        const data = await response.json() as {
          suggestions?: AddressSuggestion[];
        };
        const nextSuggestions = data.suggestions || [];
        setSuggestions(nextSuggestions);
        setShowSuggestions(nextSuggestions.length > 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Address autocomplete failed:', error);
        setSuggestions([]);
        setShowSuggestions(false);
        setHasAutocompleteError(true);
      } finally {
        if (!controller.signal.aborted) {
          setIsAutocompleteLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timerId);
      controller.abort();
    };
  }, [address.address1, address.country, isAddressInputFocused]);

  const normalizeUSState = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return '';
    return US_STATE_LOOKUP.get(normalized) || '';
  };

  const handleAddressSuggestionSelect = (suggestion: AddressSuggestion) => {
    const country = (suggestion.country || address.country || 'US').toUpperCase();
    const state = country === 'US'
      ? normalizeUSState(suggestion.state)
      : suggestion.state.trim();

    skipAutocompleteRef.current = true;
    setAddress((prev) => ({
      ...prev,
      address1: suggestion.line1 || prev.address1,
      city: suggestion.city || prev.city,
      state: suggestion.state ? state : prev.state,
      zipCode: suggestion.zipCode || prev.zipCode,
      country: country || prev.country,
    }));
    setErrors((prev) => ({
      ...prev,
      address1: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
    }));
    setShowSuggestions(false);
    setSuggestions([]);
    setHasAutocompleteError(false);
  };

  const handleChange = (field: keyof ShippingAddress, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
    // Clear error when field is edited
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const inputClassName = (field: keyof ShippingAddress) =>
    `w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
      errors[field] ? 'border-destructive' : 'border-input'
    }`;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-foreground">{t('heading')}</h4>

      {/* Name Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1">
            {t('firstName')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="firstName"
            value={address.firstName}
            onChange={(e) => handleChange('firstName', e.target.value)}
            autoComplete="given-name"
            className={inputClassName('firstName')}
          />
          {errors.firstName && (
            <p className="mt-1 text-sm text-destructive">{errors.firstName}</p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1">
            {t('lastName')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="lastName"
            value={address.lastName}
            onChange={(e) => handleChange('lastName', e.target.value)}
            autoComplete="family-name"
            className={inputClassName('lastName')}
          />
          {errors.lastName && (
            <p className="mt-1 text-sm text-destructive">{errors.lastName}</p>
          )}
        </div>
      </div>

      {/* Company (Optional) */}
      <div>
        <label htmlFor="company" className="block text-sm font-medium text-foreground mb-1">
          {t('company')} <span className="text-muted-foreground">{t('optional')}</span>
        </label>
        <input
          type="text"
          id="company"
          value={address.company}
          onChange={(e) => handleChange('company', e.target.value)}
          autoComplete="organization"
          className={inputClassName('company')}
        />
      </div>

      {/* Address Line 1 */}
      <div>
        <label htmlFor="address1" className="block text-sm font-medium text-foreground mb-1">
          {t('address')} <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            id="address1"
            value={address.address1}
            onChange={(e) => {
              handleChange('address1', e.target.value);
              setShowSuggestions(true);
              setHasAutocompleteError(false);
            }}
            onFocus={() => {
              setIsAddressInputFocused(true);
              if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onBlur={() => {
              setIsAddressInputFocused(false);
              hideSuggestionsTimerRef.current = setTimeout(() => {
                setShowSuggestions(false);
              }, 120);
            }}
            placeholder={t('streetPlaceholder')}
            autoComplete="address-line1"
            className={inputClassName('address1')}
          />
          {isAutocompleteLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-input bg-card shadow-lg max-h-64 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAddressSuggestionSelect(suggestion)}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b last:border-b-0 border-border"
                >
                  <p className="text-sm font-medium text-foreground truncate">
                    {suggestion.line1}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {suggestion.label}
                  </p>
                </button>
              ))}
              <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                {t('autocompleteAttribution')}
              </p>
            </div>
          )}
        </div>
        {errors.address1 && (
          <p className="mt-1 text-sm text-destructive">{errors.address1}</p>
        )}
        {!isAutocompleteLoading && hasAutocompleteError && address.address1.trim().length >= 3 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('autocompleteUnavailable')}
          </p>
        )}
      </div>

      {/* Address Line 2 */}
      <div>
        <label htmlFor="address2" className="block text-sm font-medium text-foreground mb-1">
          {t('address2')} <span className="text-muted-foreground">{t('optional')}</span>
        </label>
        <input
          type="text"
          id="address2"
          value={address.address2}
          onChange={(e) => handleChange('address2', e.target.value)}
          autoComplete="address-line2"
          className={inputClassName('address2')}
        />
      </div>

      {/* City, State/Region, ZIP/Postal Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="city" className="block text-sm font-medium text-foreground mb-1">
            {t('city')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="city"
            value={address.city}
            onChange={(e) => handleChange('city', e.target.value)}
            autoComplete="address-level2"
            className={inputClassName('city')}
          />
          {errors.city && (
            <p className="mt-1 text-sm text-destructive">{errors.city}</p>
          )}
        </div>
        <div>
          <label htmlFor="state" className="block text-sm font-medium text-foreground mb-1">
            {isUSAddress ? t('stateUS') : t('stateNonUS')} <span className="text-destructive">*</span>
          </label>
          {isUSAddress ? (
            <select
              id="state"
              value={address.state}
              onChange={(e) => handleChange('state', e.target.value)}
              autoComplete="address-level1"
              className={inputClassName('state')}
            >
              <option value="">{t('selectState')}</option>
              {US_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              id="state"
              value={address.state}
              onChange={(e) => handleChange('state', e.target.value)}
              placeholder={t('stateNonUS')}
              autoComplete="address-level1"
              className={inputClassName('state')}
            />
          )}
          {errors.state && (
            <p className="mt-1 text-sm text-destructive">{errors.state}</p>
          )}
        </div>
        <div>
          <label htmlFor="zipCode" className="block text-sm font-medium text-foreground mb-1">
            {usesZipCode ? t('zipCode') : t('postalCode')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="zipCode"
            value={address.zipCode}
            onChange={(e) => handleChange('zipCode', e.target.value)}
            placeholder={usesZipCode ? '12345' : t('postalPlaceholder')}
            autoComplete="postal-code"
            className={inputClassName('zipCode')}
          />
          {errors.zipCode && (
            <p className="mt-1 text-sm text-destructive">{errors.zipCode}</p>
          )}
        </div>
      </div>

      {/* Country */}
      <div>
        <label htmlFor="country" className="block text-sm font-medium text-foreground mb-1">
          {t('country')} <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            id="country"
            role="combobox"
            aria-expanded={showCountryDropdown}
            aria-autocomplete="list"
            autoComplete="country-name"
            value={countryInputValue}
            placeholder={t('countryPlaceholder')}
            onChange={(e) => {
              setCountryQuery(e.target.value);
              setShowCountryDropdown(true);
            }}
            onFocus={() => {
              setIsCountryFocused(true);
              setCountryQuery('');
              setShowCountryDropdown(true);
            }}
            onBlur={() => {
              hideCountryDropdownTimerRef.current = setTimeout(() => {
                setShowCountryDropdown(false);
                setIsCountryFocused(false);
                setCountryQuery('');
              }, 150);
            }}
            className={inputClassName('country')}
          />
          {showCountryDropdown && filteredCountries.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-20 mt-1 w-full rounded-lg border border-input bg-card shadow-lg max-h-64 overflow-y-auto"
            >
              {filteredCountries.map((c) => {
                const supported = isSupportedShippingCountry(c.code);
                return (
                  <li key={c.code} role="option" aria-selected={c.code === address.country}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (hideCountryDropdownTimerRef.current) {
                          clearTimeout(hideCountryDropdownTimerRef.current);
                        }
                        handleChange('country', c.code);
                        setShowCountryDropdown(false);
                        setIsCountryFocused(false);
                        setCountryQuery('');
                        setSuggestions([]);
                        setShowSuggestions(false);
                        setHasAutocompleteError(false);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b last:border-b-0 border-border flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-foreground">{c.name}</span>
                      {!supported && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {t('notShippable')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showCountryDropdown && filteredCountries.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-input bg-card shadow-lg px-3 py-2.5 text-sm text-muted-foreground">
              {t('noCountryMatches', { query: countryQuery })}
            </div>
          )}
        </div>
        {errors.country && (
          <p className="mt-1 text-sm text-destructive">{errors.country}</p>
        )}
        {!errors.country && address.country && !isCountrySupported && (
          <p className="mt-1 text-sm text-destructive">
            {t('unsupportedCountry', {
              country: selectedCountryName || t('unsupportedCountryFallback'),
            })}
          </p>
        )}
        {!errors.country && isCountrySupported && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('shippingAvailable')}
          </p>
        )}
      </div>
    </div>
  );
}
