import sanitize from 'sanitize-html';

/**
 * Sanitize trusted WordPress post/page content.
 *
 * Uses a PERMISSIVE approach: allows all WordPress block HTML through,
 * only stripping known XSS vectors (script tags, event handlers, javascript: URLs,
 * and dangerous embed elements).
 *
 * This stops the cycle of "fix videos → break shortcodes → fix shortcodes →
 * break reusable blocks" because we no longer maintain an allowlist of every
 * possible WordPress tag/attribute. Any new Gutenberg block just works.
 *
 * Safe because post content comes from our own WordPress CMS, not user input.
 * User-generated comments use sanitizeComment() instead.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  let cleaned = html;

  // Remove <script> tags and their contents
  cleaned = cleaned.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ''
  );

  // Remove <style> tags and their contents (inline style="" attributes are fine)
  cleaned = cleaned.replace(
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
    ''
  );

  // Remove on* event handler attributes (onclick, onload, onerror, etc.)
  cleaned = cleaned.replace(
    /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi,
    ''
  );

  // Remove javascript: protocol in href/src/action attributes
  cleaned = cleaned.replace(
    /(href|src|action)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,
    '$1=""'
  );

  // Remove dangerous embed elements (Flash/plugin vectors)
  cleaned = cleaned.replace(
    /<(object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );
  cleaned = cleaned.replace(/<(object|embed|applet)\b[^>]*\/?>/gi, '');

  // Remove <form> tags to prevent form injection (keeps inner content)
  cleaned = cleaned.replace(/<\/?form\b[^>]*>/gi, '');

  return cleaned;
}

/**
 * Sanitize user-generated comment content.
 * Uses a strict allowlist since comments come from untrusted users.
 */
export function sanitizeComment(html: string): string {
  if (!html) return '';

  return sanitize(html, {
    allowedTags: [
      'p',
      'br',
      'b',
      'i',
      'em',
      'strong',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https'],
  });
}
