'use client';

import { useState, useEffect } from 'react';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

interface Address {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

interface CustomerData {
  billing: Address;
  shipping: Address;
}

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

const emptyAddress: Address = {
  first_name: '',
  last_name: '',
  company: '',
  address_1: '',
  address_2: '',
  city: '',
  state: '',
  postcode: '',
  country: 'US',
  phone: '',
};

export default function AddressesPage() {
  const { user, token } = useAuthStore();
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingType, setEditingType] = useState<'billing' | 'shipping' | null>(null);
  const [editAddress, setEditAddress] = useState<Address>(emptyAddress);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function fetchCustomer() {
      if (!user?.id) return;

      try {
        const response = await fetch(`/api/customers/${user.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch customer data');
        }

        const data = await response.json();
        setCustomerData({
          billing: data.billing || emptyAddress,
          shipping: data.shipping || emptyAddress,
        });
      } catch (err) {
        console.error('Error fetching customer:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchCustomer();
  }, [user?.id, token]);

  const handleEdit = (type: 'billing' | 'shipping') => {
    if (customerData) {
      setEditAddress(customerData[type]);
    }
    setEditingType(type);
    setMessage(null);
  };

  const handleCopyBillingToShipping = async () => {
    if (!customerData?.billing || !user?.id) return;

    setIsSaving(true);
    setMessage(null);

    try {
      // Copy billing to shipping, excluding email field
      const shippingFromBilling = {
        first_name: customerData.billing.first_name,
        last_name: customerData.billing.last_name,
        company: customerData.billing.company,
        address_1: customerData.billing.address_1,
        address_2: customerData.billing.address_2,
        city: customerData.billing.city,
        state: customerData.billing.state,
        postcode: customerData.billing.postcode,
        country: customerData.billing.country,
        phone: customerData.billing.phone,
      };

      const response = await fetch(`/api/customers/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shipping: shippingFromBilling,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to copy address');
      }

      const data = await response.json();
      setCustomerData({
        billing: data.billing || emptyAddress,
        shipping: data.shipping || emptyAddress,
      });
      setMessage({ type: 'success', text: 'Shipping address updated from billing!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to copy address',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingType(null);
    setEditAddress(emptyAddress);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditAddress((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!editingType || !user?.id) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/customers/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          [editingType]: editAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save address');
      }

      const data = await response.json();
      setCustomerData({
        billing: data.billing || emptyAddress,
        shipping: data.shipping || emptyAddress,
      });
      setEditingType(null);
      setMessage({ type: 'success', text: 'Address saved successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save address',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderAddressForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">First Name</label>
          <input
            type="text"
            name="first_name"
            value={editAddress.first_name}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Last Name</label>
          <input
            type="text"
            name="last_name"
            value={editAddress.last_name}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Company <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          type="text"
          name="company"
          value={editAddress.company || ''}
          onChange={handleChange}
          className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Address Line 1</label>
        <input
          type="text"
          name="address_1"
          value={editAddress.address_1}
          onChange={handleChange}
          className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Address Line 2 <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          type="text"
          name="address_2"
          value={editAddress.address_2 || ''}
          onChange={handleChange}
          className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">City</label>
          <input
            type="text"
            name="city"
            value={editAddress.city}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">State</label>
          <select
            name="state"
            value={editAddress.state}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          >
            <option value="">Select state</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ZIP Code</label>
          <input
            type="text"
            name="postcode"
            value={editAddress.postcode}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
          <input
            type="tel"
            name="phone"
            value={editAddress.phone || ''}
            onChange={handleChange}
            className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Address'}
        </button>
        <button
          onClick={handleCancel}
          className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderAddress = (address: Address, type: 'billing' | 'shipping') => {
    const hasAddress = address.address_1 && address.city && address.state;

    if (!hasAddress) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">No {type} address saved yet.</p>
          <button
            onClick={() => handleEdit(type)}
            className="text-primary hover:text-primary-hover font-medium"
          >
            Add Address
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-1 text-foreground">
        <p className="font-medium">
          {address.first_name} {address.last_name}
        </p>
        {address.company && <p className="text-muted-foreground">{address.company}</p>}
        <p>{address.address_1}</p>
        {address.address_2 && <p>{address.address_2}</p>}
        <p>
          {address.city}, {address.state} {address.postcode}
        </p>
        <p>{address.country}</p>
        {address.phone && <p className="text-muted-foreground mt-2">{address.phone}</p>}
      </div>
    );
  };

  return (
    <AccountLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Addresses</h1>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        {isLoading ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading addresses...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Billing Address */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h2 className="font-semibold text-foreground">Billing Address</h2>
                {editingType !== 'billing' && customerData?.billing.address_1 && (
                  <button
                    onClick={() => handleEdit('billing')}
                    className="text-sm text-primary hover:text-primary-hover font-medium"
                  >
                    Edit
                  </button>
                )}
              </div>
              <div className="p-4">
                {editingType === 'billing'
                  ? renderAddressForm()
                  : customerData && renderAddress(customerData.billing, 'billing')}
              </div>
            </div>

            {/* Shipping Address */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h2 className="font-semibold text-foreground">Shipping Address</h2>
                <div className="flex gap-3">
                  {editingType !== 'shipping' && customerData?.billing.address_1 && (
                    <button
                      onClick={handleCopyBillingToShipping}
                      disabled={isSaving}
                      className="text-sm text-muted-foreground hover:text-foreground font-medium cursor-pointer disabled:opacity-50"
                      title="Copy billing address to shipping"
                    >
                      Use billing address
                    </button>
                  )}
                  {editingType !== 'shipping' && customerData?.shipping.address_1 && (
                    <button
                      onClick={() => handleEdit('shipping')}
                      className="text-sm text-primary hover:text-primary-hover font-medium cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4">
                {editingType === 'shipping'
                  ? renderAddressForm()
                  : customerData && renderAddress(customerData.shipping, 'shipping')}
              </div>
            </div>
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
