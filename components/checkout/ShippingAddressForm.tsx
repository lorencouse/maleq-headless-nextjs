'use client';

import { useState } from 'react';

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
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="firstName"
            value={address.firstName}
            onChange={(e) => handleChange('firstName', e.target.value)}
            className={inputClassName('firstName')}
          />
          {errors.firstName && (
            <p className="mt-1 text-sm text-red-500">{errors.firstName}</p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="lastName"
            value={address.lastName}
            onChange={(e) => handleChange('lastName', e.target.value)}
            className={inputClassName('lastName')}
          />
          {errors.lastName && (
            <p className="mt-1 text-sm text-red-500">{errors.lastName}</p>
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
          className={inputClassName('company')}
        />
      </div>

      {/* Address Line 1 */}
      <div>
        <label htmlFor="address1" className="block text-sm font-medium text-foreground mb-1">
          Address <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="address1"
          value={address.address1}
          onChange={(e) => handleChange('address1', e.target.value)}
          placeholder="Street address"
          className={inputClassName('address1')}
        />
        {errors.address1 && (
          <p className="mt-1 text-sm text-red-500">{errors.address1}</p>
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
          className={inputClassName('address2')}
        />
      </div>

      {/* City, State, Zip Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="city" className="block text-sm font-medium text-foreground mb-1">
            City <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="city"
            value={address.city}
            onChange={(e) => handleChange('city', e.target.value)}
            className={inputClassName('city')}
          />
          {errors.city && (
            <p className="mt-1 text-sm text-red-500">{errors.city}</p>
          )}
        </div>
        <div>
          <label htmlFor="state" className="block text-sm font-medium text-foreground mb-1">
            State <span className="text-red-500">*</span>
          </label>
          <select
            id="state"
            value={address.state}
            onChange={(e) => handleChange('state', e.target.value)}
            className={inputClassName('state')}
          >
            <option value="">Select state</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
          {errors.state && (
            <p className="mt-1 text-sm text-red-500">{errors.state}</p>
          )}
        </div>
        <div>
          <label htmlFor="zipCode" className="block text-sm font-medium text-foreground mb-1">
            ZIP Code <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="zipCode"
            value={address.zipCode}
            onChange={(e) => handleChange('zipCode', e.target.value)}
            placeholder="12345"
            className={inputClassName('zipCode')}
          />
          {errors.zipCode && (
            <p className="mt-1 text-sm text-red-500">{errors.zipCode}</p>
          )}
        </div>
      </div>

      {/* Country */}
      <div>
        <label htmlFor="country" className="block text-sm font-medium text-foreground mb-1">
          Country <span className="text-red-500">*</span>
        </label>
        <select
          id="country"
          value={address.country}
          onChange={(e) => handleChange('country', e.target.value)}
          className={inputClassName('country')}
        >
          <option value="US">United States</option>
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Currently shipping to US addresses only
        </p>
      </div>
    </div>
  );
}
