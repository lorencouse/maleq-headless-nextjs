import sanitize from 'sanitize-html';

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Allows safe HTML tags including iframes for embedded videos.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  return sanitize(html, {
    allowedTags: [
      ...sanitize.defaults.allowedTags,
      'iframe',
      'img',
      'video',
      'source',
    ],
    allowedAttributes: {
      ...sanitize.defaults.allowedAttributes,
      '*': ['class'],
      div: ['data-product-id'],
      iframe: [
        'src',
        'width',
        'height',
        'allow',
        'allowfullscreen',
        'frameborder',
        'scrolling',
        'loading',
      ],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
      video: [
        'src',
        'width',
        'height',
        'autoplay',
        'muted',
        'loop',
        'playsinline',
        'controls',
        'preload',
        'poster',
      ],
      source: ['src', 'type'],
    },
    allowedIframeHostnames: [
      'www.youtube.com',
      'player.vimeo.com',
    ],
  });
}
