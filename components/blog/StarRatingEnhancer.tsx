'use client';

import { useEffect } from 'react';

/**
 * LevelIndicator Component
 *
 * Transforms text-based star ratings (⭐☆☆☆☆) into clean progress bar indicators.
 * Shows a neutral scale of 1-5 without implying good/bad.
 */
export default function StarRatingEnhancer() {
  useEffect(() => {
    // Find all product specs elements
    const specElements = document.querySelectorAll(
      '.product-specs, .product-specs-cn, .entry-content'
    );

    if (specElements.length === 0) return;

    // Regex to match star rating patterns (filled ⭐ and empty ☆)
    const starPattern = /([⭐☆]{3,5})/g;

    specElements.forEach((element) => {
      // Get all text nodes that might contain star ratings
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );

      const nodesToReplace: { node: Text; matches: RegExpMatchArray[] }[] = [];

      let node;
      while ((node = walker.nextNode() as Text)) {
        const text = node.textContent || '';
        const matches = [...text.matchAll(starPattern)];
        if (matches.length > 0) {
          nodesToReplace.push({ node, matches });
        }
      }

      // Replace star patterns with styled elements
      nodesToReplace.forEach(({ node, matches }) => {
        let html = node.textContent || '';

        matches.forEach((match) => {
          const stars = match[0];
          const filled = (stars.match(/⭐/g) || []).length;
          const total = stars.length;

          // Create level indicator HTML
          const ratingHtml = createLevelIndicatorHtml(filled, total);
          html = html.replace(stars, ratingHtml);
        });

        // Create a span to hold the new HTML
        const span = document.createElement('span');
        span.innerHTML = html;

        // Replace the text node with the new span
        node.parentNode?.replaceChild(span, node);
      });
    });
  }, []);

  return null;
}

function createLevelIndicatorHtml(filled: number, total: number): string {
  // Create segmented bar
  let segmentsHtml = '';
  for (let i = 0; i < total; i++) {
    const isFilled = i < filled;
    segmentsHtml += `<span class="level-segment ${isFilled ? 'filled' : 'empty'}"></span>`;
  }

  return `<span class="level-indicator" role="img" aria-label="Level ${filled} of ${total}">
    <span class="level-segments">${segmentsHtml}</span>
    <span class="level-value">${filled}/${total}</span>
  </span>`;
}
