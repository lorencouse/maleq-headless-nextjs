export const BLOG_ADD_TO_CART_PLACEHOLDER_CLASS = 'blog-add-to-cart-placeholder';
export const BLOG_ADD_TO_CART_PRODUCT_ID_ATTR = 'data-product-id';

export const BLOG_ADD_TO_CART_PLACEHOLDER_SELECTOR = `.${BLOG_ADD_TO_CART_PLACEHOLDER_CLASS}`;

export function buildBlogAddToCartPlaceholder(productId: string): string {
  return `<div class="${BLOG_ADD_TO_CART_PLACEHOLDER_CLASS}" ${BLOG_ADD_TO_CART_PRODUCT_ID_ATTR}="${productId}"></div>`;
}
