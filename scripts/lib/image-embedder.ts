/**
 * Image Embedder
 *
 * Distributes gallery images into generated HTML descriptions
 * by inserting <img> tags between heading sections.
 */

const MAX_EMBEDDED_IMAGES = 5;

/**
 * Embed gallery images into HTML description.
 * Splits on heading boundaries and distributes images evenly.
 * Skips the thumbnail (rendered separately by frontend).
 */
export function embedImages(
  html: string,
  galleryImageUrls: string[],
  productTitle: string,
  brand: string
): string {
  if (!galleryImageUrls.length || !html) return html;

  // Limit images
  const images = galleryImageUrls.slice(0, MAX_EMBEDDED_IMAGES);
  const alt = [productTitle, brand].filter(Boolean).join(' - ');

  // Split HTML into sections at <h2> and <h3> boundaries
  // Keep the delimiters in the output
  const sections = html.split(/(?=<h[23]>)/i);

  if (sections.length <= 1) {
    // No headings found - append images at the end
    const imgTags = images
      .map((url) => `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" />`)
      .join('\n');
    return html + '\n' + imgTags;
  }

  // Distribute images: one after the first section (overview), then one per subsequent section
  const result: string[] = [];
  let imageIdx = 0;

  for (let i = 0; i < sections.length; i++) {
    result.push(sections[i]);

    // Insert image after sections (not before the first heading)
    if (imageIdx < images.length) {
      // Find the end of the last paragraph/list in this section
      const imgTag = `\n<img src="${escapeAttr(images[imageIdx])}" alt="${escapeAttr(alt)}" loading="lazy" />\n`;
      result.push(imgTag);
      imageIdx++;
    }
  }

  return result.join('');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
