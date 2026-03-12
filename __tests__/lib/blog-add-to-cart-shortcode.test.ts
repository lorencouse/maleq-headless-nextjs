import { rewriteWordPressUrls } from '@/lib/utils/image';
import { sanitizeHtml } from '@/lib/utils/sanitize';

describe('blog add-to-cart shortcode pipeline', () => {
  it('preserves the placeholder and product id through rewrite and sanitization', () => {
    const html = `
      <p>
        <p class="product woocommerce add_to_cart_inline">
          <a href="?add-to-cart=12345" data-quantity="1" class="button" data-product_id="12345">Add to cart</a>
        </p>
      </p>
    `;

    const rewritten = rewriteWordPressUrls(html);
    expect(rewritten).toContain('class="blog-add-to-cart-placeholder"');
    expect(rewritten).toContain('data-product-id="12345"');

    const sanitized = sanitizeHtml(rewritten);
    expect(sanitized).toContain('class="blog-add-to-cart-placeholder"');
    expect(sanitized).toContain('data-product-id="12345"');
  });

  it('preserves the placeholder for shortcode output without the extra paragraph wrapper', () => {
    const html = `
      <p class="product woocommerce add_to_cart_inline">
        <a href="?add-to-cart=67890" data-quantity="1" class="button" data-product_id="67890">Add to cart</a>
      </p>
    `;

    const sanitized = sanitizeHtml(rewriteWordPressUrls(html));

    expect(sanitized).toContain('class="blog-add-to-cart-placeholder"');
    expect(sanitized).toContain('data-product-id="67890"');
  });
});
