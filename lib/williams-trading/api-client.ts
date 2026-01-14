/**
 * Williams Trading API Client
 * Handles all communication with Williams Trading REST API
 */

const API_BASE_URL = process.env.WILLIAMS_TRADING_API_URL || 'http://wholesale.williams-trading.com/rest';
const IMAGE_BASE_URL = process.env.WILLIAMS_TRADING_IMAGE_BASE || 'http://images.williams-trading.com/product_images';

export interface WTManufacturer {
  code: string;
  name: string;
}

export interface WTProductType {
  code: string;
  name: string;
  description?: string;
  parent_code?: string;
}

export interface WTProduct {
  sku: string;
  name: string;
  description?: string;
  short_description?: string;
  manufacturer_code?: string;
  product_type_code?: string;
  price?: number;
  retail_price?: number;
  sale_price?: number;
  on_sale?: boolean;
  stock_quantity?: number;
  stock_status?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  upc_code?: string;
  manufacturer_sku?: string;
  release_date?: string;
  images?: string[];
}

export class WilliamsTradingClient {
  private baseUrl: string;
  private imageBaseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
    this.imageBaseUrl = IMAGE_BASE_URL;
  }

  /**
   * Fetch manufacturers from Williams Trading API
   */
  async getManufacturers(): Promise<WTManufacturer[]> {
    try {
      const response = await fetch(`${this.baseUrl}/manufacturers`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manufacturers: ${response.statusText}`);
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching manufacturers:', error);
      throw error;
    }
  }

  /**
   * Fetch product types/categories from Williams Trading API
   */
  async getProductTypes(): Promise<WTProductType[]> {
    try {
      const response = await fetch(`${this.baseUrl}/product-types`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product types: ${response.statusText}`);
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching product types:', error);
      throw error;
    }
  }

  /**
   * Fetch all products from Williams Trading API
   * @param limit - Optional limit for number of products to fetch
   * @param offset - Optional offset for pagination
   */
  async getProducts(limit?: number, offset?: number): Promise<WTProduct[]> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());

      const url = `${this.baseUrl}/products${params.toString() ? `?${params.toString()}` : ''}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.statusText}`);
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Fetch a single product by SKU
   */
  async getProduct(sku: string): Promise<WTProduct | null> {
    try {
      const response = await fetch(`${this.baseUrl}/products/${sku}`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to fetch product ${sku}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching product ${sku}:`, error);
      throw error;
    }
  }

  /**
   * Get full image URL from filename
   */
  getImageUrl(filename: string): string {
    return `${this.imageBaseUrl}/${filename}`;
  }
}

// Export singleton instance
export const wtClient = new WilliamsTradingClient();
