'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCheckoutStore } from '@/lib/store/checkout-store';
import { SHIPPING_COUNTRY_OPTIONS } from '@/lib/checkout/shipping-rates';

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
      errors[field] ? 'border-red-500' : 'border-input'
    }`;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-foreground">Shipping Address</h4>

      {/* Name Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1">
            First Name <span className="text-destructive">*</span>
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
            Last Name <span className="text-destructive">*</span>
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
          Company <span className="text-muted-foreground">(optional)</span>
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
          Address <span className="text-destructive">*</span>
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
            placeholder="Street address"
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
                Suggestions powered by OpenStreetMap
              </p>
            </div>
          )}
        </div>
        {errors.address1 && (
          <p className="mt-1 text-sm text-destructive">{errors.address1}</p>
        )}
        {!isAutocompleteLoading && hasAutocompleteError && address.address1.trim().length >= 3 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Address suggestions are temporarily unavailable. You can still enter your address manually.
          </p>
        )}
      </div>

      {/* Address Line 2 */}
      <div>
        <label htmlFor="address2" className="block text-sm font-medium text-foreground mb-1">
          Apartment, suite, etc. <span className="text-muted-foreground">(optional)</span>
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
            City <span className="text-destructive">*</span>
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
            {isUSAddress ? 'State' : 'Province / Region'} <span className="text-destructive">*</span>
          </label>
          {isUSAddress ? (
            <select
              id="state"
              value={address.state}
              onChange={(e) => handleChange('state', e.target.value)}
              autoComplete="address-level1"
              className={inputClassName('state')}
            >
              <option value="">Select state</option>
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
              placeholder="Province / Region"
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
            {isUSAddress ? 'ZIP Code' : 'Postal Code'} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="zipCode"
            value={address.zipCode}
            onChange={(e) => handleChange('zipCode', e.target.value)}
            placeholder={isUSAddress ? '12345' : 'Postal code'}
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
          Country <span className="text-destructive">*</span>
        </label>
        <select
          id="country"
          value={address.country}
          onChange={(e) => {
            handleChange('country', e.target.value);
            setSuggestions([]);
            setShowSuggestions(false);
            setHasAutocompleteError(false);
          }}
          autoComplete="country"
          className={inputClassName('country')}
        >
          {SHIPPING_COUNTRY_OPTIONS.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Domestic and international shipping options are available.
        </p>
      </div>
    </div>
  );
}
