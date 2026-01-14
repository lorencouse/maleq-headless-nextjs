import type {
  WTProduct,
  WTProductType,
  WTManufacturer,
  WTProductImage,
  WTApiResponse,
  WTRequestParams,
} from './types';

const API_BASE = process.env.WILLIAMS_TRADING_API_URL || 'http://wholesale.williams-trading.com/rest';
const IMAGE_BASE = process.env.WILLIAMS_TRADING_IMAGE_BASE || 'http://images.williams-trading.com/product_images';

export class WilliamsTradingClient {
  private baseUrl: string;
  private imageBaseUrl: string;

  constructor() {
    this.baseUrl = API_BASE;
    this.imageBaseUrl = IMAGE_BASE;
  }

  /**
   * Make a request to Williams Trading API
   */
  private async request<T>(
    endpoint: string,
    params: WTRequestParams = {}
  ): Promise<WTApiResponse<T>> {
    const queryParams = new URLSearchParams({
      format: 'json',
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)])
      ),
    });

    const url = `${this.baseUrl}/${endpoint}?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        // Cache for 5 minutes
        next: { revalidate: 300 },
      });

      if (!response.ok) {
        throw new Error(`Williams Trading API error: ${response.status} ${response.statusText}`);
      }

      // Parse Content-Range header: "items <start>-<count>/<total>"
      const contentRange = response.headers.get('X-Content-Range') || response.headers.get('Content-Range');
      let total = 0;
      let start = 0;
      let count = 0;

      if (contentRange) {
        const match = contentRange.match(/items (\d+)-(\d+)\/(\d+)/);
        if (match) {
          start = parseInt(match[1], 10);
          count = parseInt(match[2], 10);
          total = parseInt(match[3], 10);
        }
      }

      const data = await response.json();

      // Handle different response formats from Williams Trading API
      let items: any[] = [];

      if (data.products && Array.isArray(data.products)) {
        // Products endpoint returns: { products: [...] }
        items = data.products;
      } else if (data.manufacturers && Array.isArray(data.manufacturers)) {
        // Manufacturers endpoint returns: { manufacturers: [...] }
        items = data.manufacturers;
      } else if (data.categories && Array.isArray(data.categories)) {
        // Categories/types endpoint returns: { categories: [...] }
        items = data.categories;
      } else if (Array.isArray(data)) {
        // Direct array response
        items = data;
      } else if (data) {
        // Single item response
        items = [data];
      }

      return {
        items,
        total: total || items.length,
        start,
        count: items.length,
      };
    } catch (error) {
      console.error(`Error fetching from Williams Trading API: ${url}`, error);
      throw error;
    }
  }

  /**
   * Fetch all items with pagination
   */
  private async fetchAll<T>(
    endpoint: string,
    params: WTRequestParams = {},
    batchSize: number = 100
  ): Promise<T[]> {
    const allItems: T[] = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<T>(endpoint, {
        ...params,
        start,
        count: batchSize,
      });

      allItems.push(...response.items);

      // Check if there are more items
      if (response.items.length < batchSize || start + response.items.length >= response.total) {
        hasMore = false;
      } else {
        start += batchSize;
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allItems;
  }

  /**
   * Get all product types (categories)
   */
  async getProductTypes(params: WTRequestParams = {}): Promise<WTProductType[]> {
    return this.fetchAll<WTProductType>('categories', params);
  }

  /**
   * Get a single product type by code
   */
  async getProductType(code: string): Promise<WTProductType | null> {
    try {
      const response = await this.request<WTProductType>(`product-types/${code}`);
      return response.items[0] || null;
    } catch (error) {
      console.error(`Error fetching product type ${code}:`, error);
      return null;
    }
  }

  /**
   * Get all manufacturers
   */
  async getManufacturers(params: WTRequestParams = {}): Promise<WTManufacturer[]> {
    return this.fetchAll<WTManufacturer>('manufacturers', params);
  }

  /**
   * Get a single manufacturer by code
   */
  async getManufacturer(code: string): Promise<WTManufacturer | null> {
    try {
      const response = await this.request<WTManufacturer>(`manufacturers/${code}`);
      return response.items[0] || null;
    } catch (error) {
      console.error(`Error fetching manufacturer ${code}:`, error);
      return null;
    }
  }

  /**
   * Get products with optional filtering
   */
  async getProducts(params: WTRequestParams = {}): Promise<WTProduct[]> {
    return this.fetchAll<WTProduct>('products', params);
  }

  /**
   * Get a single product by SKU
   */
  async getProduct(sku: string): Promise<WTProduct | null> {
    try {
      const response = await this.request<WTProduct>(`products/${sku}`);
      return response.items[0] || null;
    } catch (error) {
      console.error(`Error fetching product ${sku}:`, error);
      return null;
    }
  }

  /**
   * Get active products only
   */
  async getActiveProducts(params: Omit<WTRequestParams, 'active'> = {}): Promise<WTProduct[]> {
    return this.getProducts({ ...params, active: '1' });
  }

  /**
   * Get inactive products only
   */
  async getInactiveProducts(params: Omit<WTRequestParams, 'active'> = {}): Promise<WTProduct[]> {
    return this.getProducts({ ...params, active: '0' });
  }

  /**
   * Get product images for a specific SKU
   */
  async getProductImages(sku: string): Promise<WTProductImage[]> {
    try {
      const response = await this.request<WTProductImage>(`product-images/${sku}`);
      return response.items;
    } catch (error) {
      console.error(`Error fetching images for product ${sku}:`, error);
      return [];
    }
  }

  /**
   * Get all product images
   */
  async getAllProductImages(params: WTRequestParams = {}): Promise<WTProductImage[]> {
    return this.fetchAll<WTProductImage>('product-images', params);
  }

  /**
   * Build full image URL from image path
   */
  getImageUrl(imagePath: string): string {
    if (imagePath.startsWith('http')) {
      return imagePath;
    }
    return `${this.imageBaseUrl}/${imagePath}`;
  }

  /**
   * Get products by manufacturer
   */
  async getProductsByManufacturer(manufacturerCode: string, params: WTRequestParams = {}): Promise<WTProduct[]> {
    return this.getProducts({ ...params, manufacturer: manufacturerCode });
  }

  /**
   * Get products by type
   */
  async getProductsByType(typeCode: string, params: WTRequestParams = {}): Promise<WTProduct[]> {
    return this.getProducts({ ...params, type: typeCode });
  }

  /**
   * Search products
   */
  async searchProducts(searchTerms: string, params: WTRequestParams = {}): Promise<WTProduct[]> {
    return this.getProducts({ ...params, search_terms: searchTerms });
  }
}

// Export singleton instance
export const williamsTradingClient = new WilliamsTradingClient();
