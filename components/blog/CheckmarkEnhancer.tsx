'use client';

import { useEffect } from 'react';

/**
 * CheckmarkEnhancer Component
 *
 * Transforms plain checkmark (✓) and X (✗) characters in product tables
 * into styled circular badges matching the pros/cons list style.
 */
export default function CheckmarkEnhancer() {
  useEffect(() => {
    // Find all product table cells
    const tableCells = document.querySelectorAll(
      '.product-table td, .product-specs td, figure.wp-block-table.product-table td'
    );

    if (tableCells.length === 0) return;

    tableCells.forEach((cell) => {
      const text = cell.textContent?.trim() || '';

      // Only transform if the cell contains ONLY a checkmark or X
      if (text === '✓' || text === '✔' || text === '✔️') {
        cell.innerHTML = `<span class="check-badge check-badge--success" aria-label="Yes">✓</span>`;
      } else if (text === '✗' || text === '✘' || text === '❌' || text === '×') {
        cell.innerHTML = `<span class="check-badge check-badge--error" aria-label="No">✗</span>`;
      }
    });
  }, []);

  return null;
}
