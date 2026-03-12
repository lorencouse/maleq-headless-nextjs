import { sanitizeHtml } from '@/lib/utils/sanitize';

const PRODUCT_DESCRIPTION_SCROLL_WRAPPER_CLASS = 'product-description-scroll';

function wrapTagWithScrollableContainer(html: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, 'gi');

  return html.replace(pattern, (match) => {
    if (match.includes(PRODUCT_DESCRIPTION_SCROLL_WRAPPER_CLASS)) {
      return match;
    }

    return `<div class="${PRODUCT_DESCRIPTION_SCROLL_WRAPPER_CLASS}">${match}</div>`;
  });
}

export function renderProductDescriptionHtml(html: string): string {
  if (!html) {
    return '';
  }

  let rendered = sanitizeHtml(html);

  // Wide rich-content blocks need a real overflow container on mobile.
  rendered = wrapTagWithScrollableContainer(rendered, 'table');
  rendered = wrapTagWithScrollableContainer(rendered, 'pre');

  return rendered;
}
