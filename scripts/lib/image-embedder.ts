/**
 * Image Embedder
 *
 * Distributes gallery images into generated HTML descriptions
 * by inserting one <img> tag after each heading section, until
 * we run out of images or headings.
 */

const MAX_EMBEDDED_IMAGES = 5;

/**
 * Embed gallery images into HTML description.
 * Inserts one image after each heading section (the content between headings).
 * Stops when we run out of images or sections.
 * Skips insertion inside table blocks.
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
  // Each section starts with a heading (except possibly the first)
  const sections = html.split(/(?=<h[23][^>]*>)/i);

  if (sections.length <= 1) {
    // No headings found — append first image at the end
    const imgTag = buildImgTag(images[0], alt);
    return html + '\n' + imgTag;
  }

  // Insert one image after each section, starting from the first section
  const result: string[] = [];
  let imageIdx = 0;

  for (let i = 0; i < sections.length; i++) {
    result.push(sections[i]);

    // Insert image after this section if we have images left
    if (imageIdx < images.length) {
      // Don't insert images after sections that end mid-table
      const openTables = (sections[i].match(/<table/gi) || []).length;
      const closeTables = (sections[i].match(/<\/table/gi) || []).length;
      if (openTables > closeTables) {
        // We're inside a table — skip image insertion here
        continue;
      }

      result.push('\n' + buildImgTag(images[imageIdx], alt) + '\n');
      imageIdx++;
    }
  }

  return result.join('');
}

function buildImgTag(url: string, alt: string): string {
  return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
