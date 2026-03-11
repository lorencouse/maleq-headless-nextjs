import sanitize from 'sanitize-html';

const TRUSTED_ALLOWED_TAGS = Array.from(
  new Set([
    ...(sanitize.defaults.allowedTags || []),
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    'iframe',
    'video',
    'audio',
    'track',
    'div',
    'span',
    'section',
    'article',
    'header',
    'footer',
    'main',
    'aside',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'colgroup',
    'col',
    'hr',
    'button',
    'details',
    'summary',
  ])
);

const TRUSTED_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'sizes'],
  picture: ['class'],
  source: ['src', 'srcset', 'type', 'media', 'sizes'],
  iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy'],
  video: ['src', 'poster', 'preload', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'width', 'height'],
  audio: ['src', 'preload', 'controls', 'autoplay', 'loop', 'muted'],
  track: ['default', 'kind', 'label', 'src', 'srclang'],
  table: ['width'],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  ol: ['start', 'type'],
  li: ['value'],
  button: ['type', 'disabled'],
};

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

  return sanitize(html, {
    allowedTags: TRUSTED_ALLOWED_TAGS,
    allowedAttributes: TRUSTED_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
      source: ['http', 'https', 'data'],
    },
    allowedIframeHostnames: [
      'www.youtube.com',
      'youtube.com',
      'youtu.be',
      'player.vimeo.com',
      'www.maleq.com',
      'maleq.com',
      'wp.maleq.com',
      'www.maleq.org',
    ],
    disallowedTagsMode: 'discard',
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
    transformTags: {
      a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
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
