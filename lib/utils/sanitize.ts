import sanitize from 'sanitize-html';

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Allows safe HTML tags used by WordPress Gutenberg blocks,
 * including video embeds, reusable blocks, and shortcode output.
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
      'audio',
      'picture',
    ],
    allowedAttributes: {
      ...sanitize.defaults.allowedAttributes,
      '*': ['class', 'id', 'style'],
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
        'controls',
        'autoplay',
        'muted',
        'loop',
        'poster',
        'preload',
        'playsinline',
      ],
      source: ['src', 'type', 'media', 'srcset', 'sizes'],
      audio: ['src', 'controls', 'autoplay', 'muted', 'loop', 'preload'],
    },
    allowedIframeHostnames: [
      'www.youtube.com',
      'player.vimeo.com',
    ],
  });
}
