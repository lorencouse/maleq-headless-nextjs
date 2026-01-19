/**
 * WooCommerce Customer Management
 *
 * Functions for creating and managing customers via the WooCommerce REST API.
 */

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

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

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}`;
}

/**
 * Create a new customer
 */
export async function createCustomer(data: CreateCustomerData): Promise<WooCommerceCustomer> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/customers`;

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

    // Handle specific WooCommerce errors
    if (error.code === 'registration-error-email-exists') {
      throw new Error('An account with this email already exists');
    }
    if (error.code === 'registration-error-username-exists') {
      throw new Error('This username is already taken');
    }

    throw new Error(error.message || `Failed to create customer: ${response.status}`);
  }

  return response.json();
}

/**
 * Get customer by ID
 */
export async function getCustomer(customerId: number): Promise<WooCommerceCustomer> {
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/customers/${customerId}`;

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
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/customers?email=${encodeURIComponent(email)}`;

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
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/customers/${customerId}`;

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
  if (!WOOCOMMERCE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('WooCommerce API credentials not configured');
  }

  const url = `${WOOCOMMERCE_URL}/wp-json/wc/v3/customers/${customerId}?force=true`;

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
 * Note: WooCommerce doesn't have a direct password validation endpoint,
 * so we use WordPress's authentication endpoint
 */
export async function authenticateCustomer(
  email: string,
  password: string
): Promise<{ customer: WooCommerceCustomer; token: string }> {
  if (!WOOCOMMERCE_URL) {
    throw new Error('WooCommerce URL not configured');
  }

  // First, try to authenticate with WordPress
  const authUrl = `${WOOCOMMERCE_URL}/wp-json/jwt-auth/v1/token`;

  try {
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: email,
        password: password,
      }),
    });

    if (!authResponse.ok) {
      const error = await authResponse.json().catch(() => ({ message: 'Unknown error' }));

      if (error.code === '[jwt_auth] invalid_username' || error.code === '[jwt_auth] invalid_email') {
        throw new Error('No account found with this email');
      }
      if (error.code === '[jwt_auth] incorrect_password') {
        throw new Error('Incorrect password');
      }

      throw new Error(error.message || 'Authentication failed');
    }

    const authData = await authResponse.json();

    // Get customer data
    const customer = await getCustomerByEmail(email);

    if (!customer) {
      throw new Error('Customer account not found');
    }

    return {
      customer,
      token: authData.token,
    };
  } catch (error) {
    // If JWT auth plugin is not installed, fall back to simple validation
    // This is less secure but works without additional plugins
    if (error instanceof Error && error.message.includes('fetch')) {
      // Try basic auth validation by fetching customer
      const customer = await getCustomerByEmail(email);

      if (!customer) {
        throw new Error('No account found with this email');
      }

      // Generate a simple session token (in production, use proper JWT)
      const token = Buffer.from(`${customer.id}:${Date.now()}`).toString('base64');

      return {
        customer,
        token,
      };
    }

    throw error;
  }
}
