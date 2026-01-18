#!/usr/bin/env bun

/**
 * Direct SQL Manufacturer/Brand Import Script
 *
 * Imports manufacturers directly into WordPress/WooCommerce MySQL database
 * Creates the product_brand product attribute taxonomy for brand filtering
 *
 * Usage:
 *   bun scripts/import-manufacturers-direct.ts [options]
 *
 * Options:
 *   --dry-run             Show what would be imported without making changes
 *   --include-inactive    Also import inactive manufacturers
 */

import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import mysql from 'mysql2/promise';

// Local by Flywheel MySQL connection
const LOCAL_MYSQL_SOCKET = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
const LOCAL_DB_NAME = 'local';
const LOCAL_DB_USER = 'root';
const LOCAL_DB_PASS = 'root';

interface ManufacturerData {
  id: string;
  code: string;
  name: string;
  active: string;
  video: string;
}

interface ImportOptions {
  dryRun: boolean;
  includeInactive: boolean;
}

interface ManufacturerMapping {
  codeToId: Record<string, number>;
  codeToSlug: Record<string, string>;
  lastUpdated: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    includeInactive: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--include-inactive') {
      options.includeInactive = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Direct SQL Manufacturer Import Script

Usage:
  bun scripts/import-manufacturers-direct.ts [options]

Options:
  --dry-run             Show what would be imported without making changes
  --include-inactive    Also import inactive manufacturers
  --help, -h            Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Generate URL-friendly slug from name
 */
function generateSlug(name: string, code: string): string {
  const base = name && name !== code ? name : code;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .substring(0, 200);
}

/**
 * Main import class
 */
class DirectManufacturerImporter {
  private connection: mysql.Connection | null = null;
  private options: ImportOptions;

  constructor(options: ImportOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.connection = await mysql.createConnection({
      socketPath: LOCAL_MYSQL_SOCKET,
      user: LOCAL_DB_USER,
      password: LOCAL_DB_PASS,
      database: LOCAL_DB_NAME,
    });
    console.log('✓ Connected to Local MySQL database\n');
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Check if a manufacturer/brand term already exists
   */
  async manufacturerExists(slug: string): Promise<number | null> {
    if (!this.connection) throw new Error('Not connected');

    const [rows] = await this.connection.execute(
      `SELECT t.term_id
       FROM wp_terms t
       JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE t.slug = ? AND tt.taxonomy = 'product_brand'`,
      [slug]
    );

    return (rows as any[]).length > 0 ? (rows as any[])[0].term_id : null;
  }

  /**
   * Import a single manufacturer
   */
  async importManufacturer(manufacturer: ManufacturerData): Promise<{ termId: number; slug: string } | null> {
    if (!this.connection) throw new Error('Not connected');

    const slug = generateSlug(manufacturer.name, manufacturer.code);

    // Check if already exists
    const existingId = await this.manufacturerExists(slug);
    if (existingId) {
      return { termId: existingId, slug };
    }

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would create: ${manufacturer.name} (${manufacturer.code})`);
      return { termId: -1, slug };
    }

    try {
      // Create term in wp_terms
      const [termResult] = await this.connection.execute(
        `INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)`,
        [manufacturer.name, slug]
      );
      const termId = (termResult as any).insertId;

      // Create term taxonomy entry
      await this.connection.execute(
        `INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
         VALUES (?, 'product_brand', ?, 0, 0)`,
        [termId, `Manufacturer code: ${manufacturer.code}`]
      );

      return { termId, slug };
    } catch (error) {
      console.error(`  ✗ Error creating ${manufacturer.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Import all manufacturers
   */
  async importManufacturers(manufacturers: ManufacturerData[]): Promise<{
    created: number;
    skipped: number;
    errors: number;
    mapping: ManufacturerMapping;
  }> {
    const results = {
      created: 0,
      skipped: 0,
      errors: 0,
      mapping: {
        codeToId: {} as Record<string, number>,
        codeToSlug: {} as Record<string, string>,
        lastUpdated: new Date().toISOString(),
      },
    };

    // Filter manufacturers
    const toImport = this.options.includeInactive
      ? manufacturers
      : manufacturers.filter(m => m.active === '1');

    console.log(`Importing ${toImport.length} manufacturers...\n`);

    for (const manufacturer of toImport) {
      const existingId = await this.manufacturerExists(generateSlug(manufacturer.name, manufacturer.code));

      if (existingId) {
        results.mapping.codeToId[manufacturer.code] = existingId;
        results.mapping.codeToSlug[manufacturer.code] = generateSlug(manufacturer.name, manufacturer.code);
        results.skipped++;
        continue;
      }

      const result = await this.importManufacturer(manufacturer);

      if (result) {
        if (!this.options.dryRun) {
          console.log(`✓ Created: ${manufacturer.name} (${manufacturer.code}) → ID: ${result.termId}`);
        }
        results.mapping.codeToId[manufacturer.code] = result.termId;
        results.mapping.codeToSlug[manufacturer.code] = result.slug;
        results.created++;
      } else {
        results.errors++;
      }
    }

    return results;
  }
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Direct SQL Brand Import              ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Dry Run: ${options.dryRun}`);
  console.log(`  Include Inactive: ${options.includeInactive}`);
  console.log();

  // Load manufacturers from JSON
  const manufacturersPath = join(process.cwd(), 'data', 'manufacturers.json');
  console.log(`Loading manufacturers from: ${manufacturersPath}`);

  const raw = readFileSync(manufacturersPath, 'utf-8');
  const data = JSON.parse(raw);
  const manufacturers: ManufacturerData[] = data.manufacturers || [];

  console.log(`✓ Loaded ${manufacturers.length} manufacturers from JSON\n`);

  // Count active
  const activeCount = manufacturers.filter(m => m.active === '1').length;
  console.log(`  Active: ${activeCount}`);
  console.log(`  Inactive: ${manufacturers.length - activeCount}\n`);

  // Import manufacturers
  const importer = new DirectManufacturerImporter(options);

  try {
    await importer.connect();
    const results = await importer.importManufacturers(manufacturers);

    // Print summary
    console.log('\n=== IMPORT SUMMARY ===');
    console.log(`Created: ${results.created}`);
    console.log(`Skipped (already exist): ${results.skipped}`);
    console.log(`Errors: ${results.errors}`);

    // Save mapping
    if (!options.dryRun) {
      const mappingPath = join(process.cwd(), 'data', 'manufacturer-mapping.json');
      writeFileSync(mappingPath, JSON.stringify(results.mapping, null, 2), 'utf-8');
      console.log(`\n✓ Mapping saved to: ${mappingPath}`);
      console.log(`  Total mappings: ${Object.keys(results.mapping.codeToId).length}`);
    }

  } finally {
    await importer.disconnect();
  }

  console.log('\n✓ Import completed successfully');
}

main().catch(error => {
  console.error('\n✗ Import failed:', error);
  process.exit(1);
});
