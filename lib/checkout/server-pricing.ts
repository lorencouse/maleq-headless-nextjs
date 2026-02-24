import { calculateAutoDiscount } from '@/lib/utils/cart-helpers';
import {
  getShippingOptions,
  getShippingPrice,
  isSupportedShippingCountry,
  normalizeCountryCode,
} from '@/lib/checkout/shipping-rates';
import {
  getAuthHeader,
  getWooCommerceEndpoint,
  isWooCommerceConfigured,
} from '@/lib/woocommerce/auth';
import { parsePrice } from '@/lib/utils/woocommerce-format';

export interface CheckoutPricingCartItemInput {
  productId: string;
  variationId?: string;
  quantity: number;
}

export interface CheckoutPricingInput {
  cartItems: CheckoutPricingCartItemInput[];
  shippingMethodId: string;
  shippingCountry?: string;
  enforceStockChecks?: boolean;
}

export interface CheckoutPricingLineItem {
  productId: string;
  variationId?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CheckoutPricingResult {
  shippingCountry: string;
  shippingMethod: {
    id: string;
    name: string;
  };
  items: CheckoutPricingLineItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
}

export class CheckoutPricingError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'CHECKOUT_PRICING_ERROR', status = 400) {
    super(message);
    this.name = 'CheckoutPricingError';
    this.status = status;
    this.code = code;
  }
}

interface WooPricePayload {
  price?: string | null;
  regular_price?: string | null;
  sale_price?: string | null;
  stock_status?: string | null;
  manage_stock?: boolean;
  stock_quantity?: number | null;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function parsePositiveInt(value: string, fieldName: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new CheckoutPricingError(`Invalid ${fieldName}`, 'INVALID_INPUT', 400);
  }
  return parsed;
}

function getWooEffectivePrice(payload: WooPricePayload): number {
  const effective = payload.sale_price || payload.price || payload.regular_price || null;
  const parsed = parsePrice(effective);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CheckoutPricingError('Product has an invalid price', 'INVALID_PRICE', 400);
  }
  return roundMoney(parsed);
}

function assertStock(payload: WooPricePayload, quantity: number): void {
  const stockStatus = (payload.stock_status || '').toLowerCase();
  if (stockStatus === 'outofstock') {
    throw new CheckoutPricingError('One or more items are out of stock', 'OUT_OF_STOCK', 409);
  }

  if (payload.manage_stock && typeof payload.stock_quantity === 'number') {
    if (payload.stock_quantity < quantity) {
      throw new CheckoutPricingError(
        'Insufficient stock for one or more items',
        'INSUFFICIENT_STOCK',
        409
      );
    }
  }
}

async function fetchWooPricePayload(
  productId: number,
  variationId?: number
): Promise<WooPricePayload> {
  const endpoint = variationId
    ? `/products/${productId}/variations/${variationId}`
    : `/products/${productId}`;

  let response: Response;
  try {
    response = await fetch(getWooCommerceEndpoint(endpoint), {
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(),
      },
      cache: 'no-store',
    });
  } catch (error) {
    throw new CheckoutPricingError(
      `Failed to fetch product pricing: ${error instanceof Error ? error.message : String(error)}`,
      'PRICING_LOOKUP_FAILED',
      502
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new CheckoutPricingError('One or more products are no longer available', 'PRODUCT_NOT_FOUND', 404);
    }
    throw new CheckoutPricingError(
      `Failed to fetch product pricing (${response.status})`,
      'PRICING_LOOKUP_FAILED',
      502
    );
  }

  const json = (await response.json()) as WooPricePayload;
  return json;
}

export async function computeAuthoritativeCheckoutPricing(
  input: CheckoutPricingInput
): Promise<CheckoutPricingResult> {
  const enforceStockChecks = input.enforceStockChecks !== false;

  if (!isWooCommerceConfigured()) {
    throw new CheckoutPricingError(
      'WooCommerce API credentials not configured',
      'CONFIG_ERROR',
      500
    );
  }

  if (!Array.isArray(input.cartItems) || input.cartItems.length === 0) {
    throw new CheckoutPricingError('Cart cannot be empty', 'EMPTY_CART', 400);
  }

  const shippingCountry = normalizeCountryCode(input.shippingCountry);
  if (!isSupportedShippingCountry(shippingCountry)) {
    throw new CheckoutPricingError('Unsupported shipping country', 'UNSUPPORTED_COUNTRY', 400);
  }

  const shippingOptions = getShippingOptions(shippingCountry);
  const shippingOption = shippingOptions.find((option) => option.id === input.shippingMethodId);
  if (!shippingOption) {
    throw new CheckoutPricingError('Invalid shipping method', 'INVALID_SHIPPING_METHOD', 400);
  }

  const pricedItems = await Promise.all(
    input.cartItems.map(async (item) => {
      const productId = parsePositiveInt(item.productId, 'productId');
      const variationId = item.variationId
        ? parsePositiveInt(item.variationId, 'variationId')
        : undefined;
      const quantity = item.quantity;

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        throw new CheckoutPricingError('Invalid quantity', 'INVALID_QUANTITY', 400);
      }

      const pricePayload = await fetchWooPricePayload(productId, variationId);
      if (enforceStockChecks) {
        assertStock(pricePayload, quantity);
      }
      const unitPrice = getWooEffectivePrice(pricePayload);
      const lineTotal = roundMoney(unitPrice * quantity);

      return {
        productId: String(productId),
        variationId: variationId ? String(variationId) : undefined,
        quantity,
        unitPrice,
        lineTotal,
      };
    })
  );

  const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  const shipping = roundMoney(getShippingPrice(shippingOption, subtotal));
  const discount = roundMoney(calculateAutoDiscount(subtotal).amount);
  const tax = 0;
  const total = roundMoney(Math.max(0, subtotal + shipping + tax - discount));

  return {
    shippingCountry,
    shippingMethod: {
      id: shippingOption.id,
      name: shippingOption.name,
    },
    items: pricedItems,
    subtotal,
    shipping,
    tax,
    discount,
    total,
  };
}
