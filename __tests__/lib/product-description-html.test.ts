import { renderProductDescriptionHtml } from '@/lib/product/description-html';

describe('renderProductDescriptionHtml', () => {
  it('wraps tables in a scroll container after sanitization', () => {
    const html = '<p>Specs</p><table><tr><th>Size</th><td>Large</td></tr></table>';

    const rendered = renderProductDescriptionHtml(html);

    expect(rendered).toContain('<div class="product-description-scroll"><table>');
    expect(rendered).toContain('</table></div>');
  });

  it('wraps preformatted blocks in a scroll container', () => {
    const html = '<pre>super long content line</pre>';

    const rendered = renderProductDescriptionHtml(html);

    expect(rendered).toContain('<div class="product-description-scroll"><pre>');
  });

  it('rewrites root-relative wp-content image URLs to an absolute host', () => {
    const html =
      '<img src="/wp-content/uploads/2026/01/example.webp" alt="Example" />';

    const rendered = renderProductDescriptionHtml(html);

    expect(rendered).not.toContain('src="/wp-content/');
    expect(rendered).toMatch(
      /src="https?:\/\/[^"]+\/wp-content\/uploads\/2026\/01\/example\.webp"/
    );
  });

  it('still sanitizes unsafe markup before wrapping scrollable elements', () => {
    const html = '<table><tr><td><script>alert(1)</script>safe</td></tr></table>';

    const rendered = renderProductDescriptionHtml(html);

    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('product-description-scroll');
    expect(rendered).toContain('safe');
  });
});
