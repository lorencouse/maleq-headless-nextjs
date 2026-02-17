/**
 * CSV Writer
 *
 * Writes enrichment results to RFC 4180 CSV using csv-stringify.
 */

import { stringify } from 'csv-stringify/sync';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

export interface CsvRow {
  post_id: number;
  post_type: string;
  parent_id: number | string;
  sku: string;
  barcode: string;
  title: string;
  post_content: string;
  post_excerpt: string;
  meta_title: string;
  meta_description: string;
  brand: string;
  categories: string;
  images_embedded: number;
  data_sources: string;
  enrichment_status: string;
  enrichment_path: string;
}

const CSV_COLUMNS: (keyof CsvRow)[] = [
  'post_id',
  'post_type',
  'parent_id',
  'sku',
  'barcode',
  'title',
  'post_content',
  'post_excerpt',
  'meta_title',
  'meta_description',
  'brand',
  'categories',
  'images_embedded',
  'data_sources',
  'enrichment_status',
  'enrichment_path',
];

/**
 * Write CSV header to a new file (overwrites if exists).
 */
export function writeCsvHeader(filePath: string): void {
  const header = stringify([], { header: true, columns: CSV_COLUMNS });
  writeFileSync(filePath, header);
}

/**
 * Append rows to existing CSV file (no header).
 */
export function appendCsvRows(filePath: string, rows: CsvRow[]): void {
  if (rows.length === 0) return;
  const csv = stringify(rows, { header: false, columns: CSV_COLUMNS });
  appendFileSync(filePath, csv);
}

/**
 * Write all rows to a new CSV file (with header).
 */
export function writeCsv(filePath: string, rows: CsvRow[]): void {
  const csv = stringify(rows, { header: true, columns: CSV_COLUMNS });
  writeFileSync(filePath, csv);
}
