/**
 * WooCommerce Customer Management
 *
 * Functions for creating and managing customers via the WooCommerce REST API.
 */

import { UserFacingError } from '@/lib/api/response';
import type { GoogleProfile } from '@/lib/auth/google';

import { getWooCommerceUrl, getAuthHeader, isWooCommerceConfigured } from './auth';

export interface CustomerAddress {
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

export interface WooCommerceCustomer {
  id: number;
  date_created: string;
  date_modified: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  username: string;
  billing: CustomerAddress;
  shipping: CustomerAddress;
  is_paying_customer: boolean;
  avatar_url: string;
  meta_data: Array<{
    id: number;
    key: string;
    value: string;
  }>;
}

export interface CreateCustomerData {
  email: string;
  first_name: string;
  last_name: string;
  username?: string;
  password: string;
  billing?: Partial<CustomerAddress>;
  shipping?: Partial<CustomerAddress>;
}

export interface UpdateCustomerData {
  email?: string;
  first_name?: string;
  last_name?: string;
  billing?: Partial<CustomerAddress>;
  shipping?: Partial<CustomerAddress>;
  password?: string;
}

/**
 * Create a new customer
 */
export async function createCustomer(data: CreateCustomerData): Promise<WooCommerceCustomer> {
  if (!isWooCommerceConfigured()) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${getWooCommerceUrl()}/wp-json/wc/v3/customers`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));

    // Handle specific WooCommerce errors with user-facing messages
    if (error.code === 'registration-error-email-exists') {
      throw new UserFacingError('An account with this email already exists', 409, 'ACCOUNT_EXISTS');
    }
    if (error.code === 'registration-error-username-exists') {
      throw new UserFacingError('This username is already taken', 409, 'USERNAME_EXISTS');
    }

    throw new Error(error.message || `Failed to create customer: ${response.status}`);
  }

  return response.json();
}

/**
 * Get customer by ID
 */
export async function getCustomer(customerId: number): Promise<WooCommerceCustomer> {
  if (!isWooCommerceConfigured()) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${getWooCommerceUrl()}/wp-json/wc/v3/customers/${customerId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to get customer: ${response.status}`);
  }

  return response.json();
}

/**
 * Get customer by email
 */
export async function getCustomerByEmail(email: string): Promise<WooCommerceCustomer | null> {
  if (!isWooCommerceConfigured()) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${getWooCommerceUrl()}/wp-json/wc/v3/customers?email=${encodeURIComponent(email)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to get customer: ${response.status}`);
  }

  const customers = await response.json();
  return customers.length > 0 ? customers[0] : null;
}

/**
 * Update customer
 */
export async function updateCustomer(
  customerId: number,
  data: UpdateCustomerData
): Promise<WooCommerceCustomer> {
  if (!isWooCommerceConfigured()) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${getWooCommerceUrl()}/wp-json/wc/v3/customers/${customerId}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to update customer: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete customer
 */
export async function deleteCustomer(customerId: number): Promise<void> {
  if (!isWooCommerceConfigured()) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${getWooCommerceUrl()}/wp-json/wc/v3/customers/${customerId}?force=true`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': getAuthHeader(),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to delete customer: ${response.status}`);
  }
}

/**
 * Authenticate customer (validate password)
 * Uses custom Male Q auth endpoint for secure password validation
 * @param login - Email address or username
 * @param password - User password
 */
export async function authenticateCustomer(
  login: string,
  password: string
): Promise<{ customer: WooCommerceCustomer; token: string }> {
  // Use our custom auth endpoint for secure password validation
  const authUrl = `${getWooCommerceUrl()}/wp-json/maleq/v1/validate-password`;

  const authResponse = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });

  const authData = await authResponse.json();

  if (!authResponse.ok) {
    // Handle specific error codes from our endpoint
    if (authData.code === 'invalid_credentials') {
      throw new UserFacingError('Invalid email/username or password', 401, 'INVALID_CREDENTIALS');
    }
    throw new UserFacingError(authData.message || 'Authentication failed', 401);
  }

  // Customer data is returned directly from the auth endpoint
  if (!authData.customer) {
    throw new Error('Customer account not found');
  }

  return {
    customer: mapAuthEndpointCustomer(authData.customer),
    token: authData.token,
  };
}

/**
 * Map the `customer` object returned by the maleq auth endpoints to the
 * WooCommerceCustomer shape used throughout the app.
 */
function mapAuthEndpointCustomer(raw: Record<string, unknown>): WooCommerceCustomer {
  return {
    id: raw.id as number,
    date_created: '',
    date_modified: '',
    email: raw.email as string,
    first_name: (raw.first_name as string) || '',
    last_name: (raw.last_name as string) || '',
    role: (raw.role as string) || 'customer',
    username: (raw.username as string) || '',
    billing: (raw.billing as CustomerAddress) || ({} as CustomerAddress),
    shipping: (raw.shipping as CustomerAddress) || ({} as CustomerAddress),
    is_paying_customer: false,
    avatar_url: (raw.avatar_url as string) || '',
    meta_data: [],
  };
}

/**
 * Authenticate (find-or-create) a customer from a verified Google profile.
 * Calls the maleq/v1/google-auth endpoint, which is guarded by a shared secret.
 * The Google ID token must already have been verified server-side.
 */
export async function authenticateWithGoogle(
  profile: GoogleProfile
): Promise<{ customer: WooCommerceCustomer; token: string }> {
  const secret = process.env.MALEQ_GOOGLE_AUTH_SECRET;
  if (!secret) {
    throw new UserFacingError('Google sign-in is not configured', 500, 'GOOGLE_UNCONFIGURED');
  }

  const authUrl = `${getWooCommerceUrl()}/wp-json/maleq/v1/google-auth`;

  const authResponse = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Maleq-Google-Secret': secret,
    },
    body: JSON.stringify({
      email: profile.email,
      first_name: profile.firstName,
      last_name: profile.lastName,
      google_id: profile.googleId,
      avatar_url: profile.avatarUrl,
    }),
  });

  const authData = await authResponse.json().catch(() => null);

  if (!authResponse.ok || !authData?.customer) {
    throw new UserFacingError(
      authData?.message || 'Google sign-in failed',
      authResponse.status >= 400 && authResponse.status < 500 ? 401 : 502
    );
  }

  return {
    customer: mapAuthEndpointCustomer(authData.customer),
    token: authData.token,
  };
}
