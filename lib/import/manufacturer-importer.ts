import { wooClient } from '../woocommerce/client';
import type { WooManufacturer } from '../woocommerce/types';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ManufacturerData {
  id: string;
  code: string;
  name: string;
  active: string;
  video: string;
}

interface ManufacturerMapping {
  codeToId: Record<string, number>;
  codeToSlug: Record<string, string>;
  lastUpdated: string;
}

/**
 * Import manufacturers from JSON file into WooCommerce
 * Creates custom taxonomy terms for manufacturers
 */
export class ManufacturerImporter {
  private manufacturersPath: string;
  private mappingPath: string;

  constructor() {
    this.manufacturersPath = join(process.cwd(), 'data', 'manufacturers.json');
    this.mappingPath = join(process.cwd(), 'data', 'manufacturer-mapping.json');
  }

  /**
   * Load manufacturers from JSON file
   */
  private loadManufacturers(): ManufacturerData[] {
    const raw = readFileSync(this.manufacturersPath, 'utf-8');
    const data = JSON.parse(raw);
    return data.manufacturers || [];
  }

  /**
   * Save manufacturer mapping to file
   */
  private saveMapping(mapping: ManufacturerMapping): void {
    writeFileSync(this.mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
    console.log(`✓ Manufacturer mapping saved to ${this.mappingPath}`);
  }

  /**
   * Generate slug from manufacturer name/code
   */
  private generateSlug(name: string, code: string): string {
    // Use name if meaningful, otherwise use code
    const base = name && name !== code ? name : code;
    return base
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * Import all active manufacturers
   */
  async importManufacturers(): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('\n=== IMPORTING MANUFACTURERS ===\n');

    const manufacturers = this.loadManufacturers();
    console.log(`Found ${manufacturers.length} manufacturers in JSON file`);

    // Filter to only active manufacturers
    const activeManufacturers = manufacturers.filter(m => m.active === '1');
    console.log(`Filtering to ${activeManufacturers.length} active manufacturers\n`);

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    const mapping: ManufacturerMapping = {
      codeToId: {},
      codeToSlug: {},
      lastUpdated: new Date().toISOString(),
    };

    // Try to get existing manufacturers
    let existingManufacturers: WooManufacturer[] = [];
    try {
      existingManufacturers = await wooClient.getManufacturers();
      console.log(`Found ${existingManufacturers.length} existing manufacturers in WooCommerce\n`);
    } catch (error) {
      console.warn('Could not fetch existing manufacturers (taxonomy may not exist yet)');
      console.warn('Note: You may need to register the manufacturer taxonomy in WordPress first\n');
    }

    // Create a map of existing manufacturers by slug
    const existingBySlug = new Map<string, WooManufacturer>();
    existingManufacturers.forEach(m => {
      if (m.slug) {
        existingBySlug.set(m.slug, m);
      }
    });

    // Import each manufacturer
    for (const manufacturer of activeManufacturers) {
      try {
        const slug = this.generateSlug(manufacturer.name, manufacturer.code);
        const existing = existingBySlug.get(slug);

        if (existing && existing.id) {
          // Manufacturer already exists
          console.log(`⊕ Exists: ${manufacturer.name} (${manufacturer.code})`);
          mapping.codeToId[manufacturer.code] = existing.id;
          mapping.codeToSlug[manufacturer.code] = slug;
          results.skipped++;
        } else {
          // Create new manufacturer
          const newManufacturer: WooManufacturer = {
            name: manufacturer.name,
            slug,
            description: `Manufacturer code: ${manufacturer.code}`,
          };

          const created = await wooClient.createManufacturer(newManufacturer);

          if (created.id) {
            console.log(`✓ Created: ${manufacturer.name} (${manufacturer.code}) → ID: ${created.id}`);
            mapping.codeToId[manufacturer.code] = created.id;
            mapping.codeToSlug[manufacturer.code] = slug;
            results.created++;
          } else {
            throw new Error('No ID returned from API');
          }
        }
      } catch (error) {
        const errorMsg = `Failed to import ${manufacturer.name} (${manufacturer.code}): ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`✗ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    // Save mapping
    this.saveMapping(mapping);

    // Print summary
    console.log('\n=== MANUFACTURER IMPORT SUMMARY ===');
    console.log(`✓ Created: ${results.created}`);
    console.log(`⊕ Skipped (already exist): ${results.skipped}`);
    console.log(`✗ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.forEach(err => console.log(`  - ${err}`));
    }

    return results;
  }

  /**
   * Load manufacturer mapping from file
   */
  loadMapping(): ManufacturerMapping | null {
    try {
      const raw = readFileSync(this.mappingPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
