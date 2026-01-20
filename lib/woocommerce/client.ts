import type {
  WooProduct,
  WooProductVariation,
  WooCategory,
  WooManufacturer,
  WooMediaItem,
  WooStockUpdate,
  WooBatchRequest,
  WooBatchResponse,
  WooReview,
  WooCoupon,
} from './types';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

if (!WOOCOMMERCE_URL) {
  console.warn('WooCommerce URL not configured');
}

class WooCommerceClient {
  private baseUrl: string;
  private auth: string;

  constructor() {
    // Extract base URL without /graphql if present
    this.baseUrl = WOOCOMMERCE_URL?.replace('/graphql', '') || '';
    this.auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/wp-json/wc/v3${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${this.auth}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`WooCommerce API Error: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  // WordPress REST API request (for media uploads)
  private async wpRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/wp-json/wp/v2${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`WordPress API Error: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  // ============ PRODUCTS ============

  async getProducts(params: {
    per_page?: number;
    page?: number;
    search?: string;
    sku?: string;
    status?: string;
  } = {}): Promise<WooProduct[]> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    return this.request<WooProduct[]>(`/products?${searchParams.toString()}`);
  }

  async getProductBySku(sku: string): Promise<WooProduct | null> {
    const products = await this.getProducts({ sku });
    return products[0] || null;
  }

  async getProductById(id: number): Promise<WooProduct> {
    return this.request<WooProduct>(`/products/${id}`);
  }

  async createProduct(product: WooProduct): Promise<WooProduct> {
    return this.request<WooProduct>('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  }

  async updateProduct(id: number, product: Partial<WooProduct>): Promise<WooProduct> {
    return this.request<WooProduct>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    });
  }

  async deleteProduct(id: number, force = false): Promise<WooProduct> {
    return this.request<WooProduct>(`/products/${id}?force=${force}`, {
      method: 'DELETE',
    });
  }

  async batchProducts(batch: WooBatchRequest<WooProduct>): Promise<WooBatchResponse<WooProduct>> {
    return this.request<WooBatchResponse<WooProduct>>('/products/batch', {
      method: 'POST',
      body: JSON.stringify(batch),
    });
  }

  // ============ PRODUCT VARIATIONS ============

  async getVariations(productId: number): Promise<WooProductVariation[]> {
    return this.request<WooProductVariation[]>(`/products/${productId}/variations`);
  }

  async createVariation(productId: number, variation: Partial<WooProductVariation>): Promise<WooProductVariation> {
    return this.request<WooProductVariation>(`/products/${productId}/variations`, {
      method: 'POST',
      body: JSON.stringify(variation),
    });
  }

  async updateVariation(productId: number, variationId: number, variation: Partial<WooProductVariation>): Promise<WooProductVariation> {
    return this.request<WooProductVariation>(`/products/${productId}/variations/${variationId}`, {
      method: 'PUT',
      body: JSON.stringify(variation),
    });
  }

  // ============ CATEGORIES ============

  async getCategories(params: {
    per_page?: number;
    page?: number;
    search?: string;
    slug?: string;
  } = {}): Promise<WooCategory[]> {
    const searchParams = new URLSearchParams();
    searchParams.append('per_page', '100'); // Get all categories
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    return this.request<WooCategory[]>(`/products/categories?${searchParams.toString()}`);
  }

  async getCategoryBySlug(slug: string): Promise<WooCategory | null> {
    const categories = await this.getCategories({ slug });
    return categories[0] || null;
  }

  async createCategory(category: WooCategory): Promise<WooCategory> {
    return this.request<WooCategory>('/products/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
  }

  async updateCategory(id: number, category: Partial<WooCategory>): Promise<WooCategory> {
    return this.request<WooCategory>(`/products/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(category),
    });
  }

  // ============ PRODUCT ATTRIBUTES ============

  async getAttributes(): Promise<{ id: number; name: string; slug: string }[]> {
    return this.request('/products/attributes');
  }

  async createAttribute(attribute: { name: string; slug?: string; type?: string; order_by?: string }): Promise<{ id: number; name: string; slug: string }> {
    return this.request('/products/attributes', {
      method: 'POST',
      body: JSON.stringify(attribute),
    });
  }

  async getAttributeTerms(attributeId: number): Promise<{ id: number; name: string; slug: string }[]> {
    return this.request(`/products/attributes/${attributeId}/terms?per_page=100`);
  }

  async createAttributeTerm(attributeId: number, term: { name: string; slug?: string }): Promise<{ id: number; name: string; slug: string }> {
    return this.request(`/products/attributes/${attributeId}/terms`, {
      method: 'POST',
      body: JSON.stringify(term),
    });
  }

  // ============ MANUFACTURERS (Custom Taxonomy via WordPress REST API) ============
  // Note: Requires the manufacturer taxonomy to be registered in WordPress

  async getManufacturers(): Promise<WooManufacturer[]> {
    try {
      return await this.wpRequest<WooManufacturer[]>('/manufacturer?per_page=100');
    } catch {
      // Fallback: manufacturers might be stored as product attributes
      console.warn('Manufacturer taxonomy not available, falling back to attributes');
      return [];
    }
  }

  async getManufacturerBySlug(slug: string): Promise<WooManufacturer | null> {
    try {
      const manufacturers = await this.wpRequest<WooManufacturer[]>(`/manufacturer?slug=${slug}`);
      return manufacturers[0] || null;
    } catch {
      return null;
    }
  }

  async createManufacturer(manufacturer: WooManufacturer): Promise<WooManufacturer> {
    return this.wpRequest<WooManufacturer>('/manufacturer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manufacturer),
    });
  }

  async updateManufacturer(id: number, manufacturer: Partial<WooManufacturer>): Promise<WooManufacturer> {
    return this.wpRequest<WooManufacturer>(`/manufacturer/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manufacturer),
    });
  }

  // ============ MEDIA / IMAGES ============

  async uploadImage(imageUrl: string, filename: string, altText?: string): Promise<WooMediaItem> {
    // Add timeout to prevent hanging
    const timeout = 30000; // 30 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Download image from external URL
      const imageResponse = await fetch(imageUrl, {
        signal: controller.signal,
        // Add timeout at the fetch level
        // @ts-ignore - signal is valid
        timeout: 20000
      });

      if (!imageResponse.ok) {
        throw new Error(`Failed to download image (${imageResponse.status}): ${imageUrl}`);
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

      // Upload to WordPress media library
      const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: imageBuffer,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Failed to upload image: ${error.message || response.statusText}`);
      }

      const media = await response.json() as WooMediaItem;

      // Update alt text if provided
      if (altText && media.id) {
        await this.wpRequest(`/media/${media.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alt_text: altText }),
        });
      }

      return media;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Image upload timed out after ${timeout}ms: ${imageUrl}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getMediaByFilename(filename: string): Promise<WooMediaItem | null> {
    const media = await this.wpRequest<WooMediaItem[]>(`/media?search=${encodeURIComponent(filename)}&per_page=1`);
    return media[0] || null;
  }

  // ============ STOCK ============

  async updateStock(productId: number, quantity: number, status?: 'instock' | 'outofstock' | 'onbackorder'): Promise<WooProduct> {
    const update: Partial<WooProduct> = {
      stock_quantity: quantity,
      manage_stock: true,
    };

    if (status) {
      update.stock_status = status;
    } else {
      // Auto-calculate status
      update.stock_status = quantity > 0 ? 'instock' : 'outofstock';
    }

    return this.updateProduct(productId, update);
  }

  async batchUpdateStock(updates: WooStockUpdate[]): Promise<WooBatchResponse<WooProduct>> {
    const batch: WooBatchRequest<Partial<WooProduct>> = {
      update: updates.map(u => ({
        id: u.id,
        stock_quantity: u.stock_quantity,
        stock_status: u.stock_status,
        manage_stock: true,
      })),
    };

    return this.request<WooBatchResponse<WooProduct>>('/products/batch', {
      method: 'POST',
      body: JSON.stringify(batch),
    });
  }

  // ============ REVIEWS ============

  async getReviews(params: {
    product?: number;
    per_page?: number;
    page?: number;
    status?: 'approved' | 'hold' | 'spam' | 'trash' | 'all';
  } = {}): Promise<WooReview[]> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    return this.request<WooReview[]>(`/products/reviews?${searchParams.toString()}`);
  }

  async getProductReviews(productId: number, params: {
    per_page?: number;
    page?: number;
  } = {}): Promise<WooReview[]> {
    return this.getReviews({ product: productId, status: 'approved', ...params });
  }

  async getReviewById(reviewId: number): Promise<WooReview> {
    return this.request<WooReview>(`/products/reviews/${reviewId}`);
  }

  async createReview(review: Omit<WooReview, 'id' | 'date_created' | 'date_created_gmt' | 'verified' | 'reviewer_avatar_urls'>): Promise<WooReview> {
    return this.request<WooReview>('/products/reviews', {
      method: 'POST',
      body: JSON.stringify(review),
    });
  }

  async updateReview(reviewId: number, review: Partial<WooReview>): Promise<WooReview> {
    return this.request<WooReview>(`/products/reviews/${reviewId}`, {
      method: 'PUT',
      body: JSON.stringify(review),
    });
  }

  async deleteReview(reviewId: number, force = false): Promise<WooReview> {
    return this.request<WooReview>(`/products/reviews/${reviewId}?force=${force}`, {
      method: 'DELETE',
    });
  }

  // ============ COUPONS ============

  async getCoupons(params: {
    code?: string;
    per_page?: number;
    page?: number;
  } = {}): Promise<WooCoupon[]> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    return this.request<WooCoupon[]>(`/coupons?${searchParams.toString()}`);
  }

  async getCouponByCode(code: string): Promise<WooCoupon | null> {
    const coupons = await this.getCoupons({ code });
    return coupons[0] || null;
  }

  async getCouponById(id: number): Promise<WooCoupon> {
    return this.request<WooCoupon>(`/coupons/${id}`);
  }

  async validateCoupon(code: string, cartTotal: number, productIds?: number[]): Promise<{
    valid: boolean;
    coupon?: WooCoupon;
    discountAmount?: number;
    message: string;
  }> {
    try {
      const coupon = await this.getCouponByCode(code);

      if (!coupon) {
        return { valid: false, message: 'Coupon not found' };
      }

      // Check if coupon has expired
      if (coupon.date_expires_gmt) {
        const expiryDate = new Date(coupon.date_expires_gmt);
        if (expiryDate < new Date()) {
          return { valid: false, message: 'This coupon has expired' };
        }
      }

      // Check usage limit
      if (coupon.usage_limit && coupon.usage_count !== undefined) {
        if (coupon.usage_count >= coupon.usage_limit) {
          return { valid: false, message: 'This coupon has reached its usage limit' };
        }
      }

      // Check minimum amount
      if (coupon.minimum_amount) {
        const minAmount = parseFloat(coupon.minimum_amount);
        if (cartTotal < minAmount) {
          return { valid: false, message: `Minimum order amount of $${minAmount.toFixed(2)} required` };
        }
      }

      // Check maximum amount
      if (coupon.maximum_amount) {
        const maxAmount = parseFloat(coupon.maximum_amount);
        if (cartTotal > maxAmount) {
          return { valid: false, message: `Maximum order amount of $${maxAmount.toFixed(2)} exceeded` };
        }
      }

      // Check product restrictions
      if (productIds && coupon.product_ids && coupon.product_ids.length > 0) {
        const hasValidProduct = productIds.some(id => coupon.product_ids!.includes(id));
        if (!hasValidProduct) {
          return { valid: false, message: 'This coupon is not valid for the products in your cart' };
        }
      }

      // Check excluded products
      if (productIds && coupon.excluded_product_ids && coupon.excluded_product_ids.length > 0) {
        const hasExcludedProduct = productIds.some(id => coupon.excluded_product_ids!.includes(id));
        if (hasExcludedProduct) {
          return { valid: false, message: 'This coupon cannot be applied to some products in your cart' };
        }
      }

      // Calculate discount amount
      let discountAmount = 0;
      const amount = parseFloat(coupon.amount);

      switch (coupon.discount_type) {
        case 'percent':
          discountAmount = (cartTotal * amount) / 100;
          break;
        case 'fixed_cart':
          discountAmount = Math.min(amount, cartTotal);
          break;
        case 'fixed_product':
          discountAmount = Math.min(amount, cartTotal);
          break;
        default:
          discountAmount = 0;
      }

      return {
        valid: true,
        coupon,
        discountAmount: Math.round(discountAmount * 100) / 100,
        message: 'Coupon applied successfully',
      };
    } catch (error) {
      console.error('Error validating coupon:', error);
      return { valid: false, message: 'Error validating coupon' };
    }
  }

  // ============ UTILITY ============

  async testConnection(): Promise<boolean> {
    try {
      await this.request('/products?per_page=1');
      return true;
    } catch (error) {
      console.error('WooCommerce connection test failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const wooClient = new WooCommerceClient();

// Export class for testing
export { WooCommerceClient };
