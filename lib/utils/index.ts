/**
 * Barrel export for utility functions
 */

// Cart helpers
export {
  generateCartItemId,
  calculateLineSubtotal,
  calculateCartSubtotal,
  calculateItemCount,
  calculateCartTotal,
  validateQuantity,
  formatPrice as formatCartPrice,
  calculateSavings,
  calculateSavingsPercentage,
  mergeCartItem,
  isSameProduct,
  getCartSummary,
  createEmptyCart,
  isCartEmpty,
  getUniqueProductCount,
  estimateTax,
  getFreeShippingProgress,
} from './cart-helpers';

// Category helpers
export {
  findCategoryBySlug,
  flattenCategories,
  findParentCategory,
} from './category-helpers';

// Image utilities
export {
  getProductionImageUrl,
  getImagePath,
  processContentImages,
  processWordPressContent,
} from './image';

// Newsletter utilities
export {
  isSubscribed as isNewsletterSubscribed,
  markAsSubscribed as markNewsletterSubscribed,
  isPopupDismissed,
  dismissPopup,
  isValidEmail as isValidNewsletterEmail,
} from './newsletter';
export type { NewsletterSubscription } from './newsletter';

// Recently viewed utilities
export {
  getRecentlyViewed,
  addToRecentlyViewed,
  removeFromRecentlyViewed,
  clearRecentlyViewed,
  isRecentlyViewed,
} from './recently-viewed';
export type { RecentlyViewedItem } from './recently-viewed';

// Stock alerts utilities
export {
  getStockAlerts,
  isSubscribedToAlert,
  getAlertEmail,
  addStockAlert,
  removeStockAlert,
  clearStockAlerts,
  isValidEmail as isValidStockAlertEmail,
} from './stock-alerts';
export type { StockAlert } from './stock-alerts';

// Tax calculator
export {
  NO_TAX_STATES,
  getStateTaxRate,
  stateHasSalesTax,
  calculateTax,
  formatTaxRate,
} from './tax-calculator';
export type { TaxCalculationResult } from './tax-calculator';

// Toast notifications
export {
  showSuccess,
  showError,
  showLoading,
  showInfo,
  showToastWithAction,
  dismissToast,
  dismissAllToasts,
  showPromiseToast,
} from './toast';

// WooCommerce formatting
export {
  formatAttributeName,
  formatAttributeValue,
  formatPrice,
  parsePrice,
  formatVariationName,
} from './woocommerce-format';

// Text utilities
export {
  toTitleCase,
  generateSlug,
  truncateText,
  normalizeWhitespace,
  stripHtml,
  decodeHtmlEntities,
  extractSentences,
  generateShortDescription,
  cleanProductName,
  cleanDescription,
  capitalize,
  toCamelCase,
  toKebabCase,
  countWords,
  isBlank,
} from './text-utils';

// Static params utilities
export {
  DEV_LIMITS,
  isDevelopment,
  shouldLimitParams,
  limitStaticParams,
  logStaticParamsInfo,
} from './static-params';
