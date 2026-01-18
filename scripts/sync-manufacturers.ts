import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

interface Manufacturer {
  id: string;
  code: string;
  name: string;
  active: string;
  video: string;
}

interface ManufacturersData {
  manufacturers: Manufacturer[];
}

// Manufacturers extracted from products-filtered.xml
const xmlManufacturers: { code: string; name: string }[] = [
  { code: 'AC', name: 'Aloe Cadabra Lubes' },
  { code: 'ANE', name: 'Aneros Toys' },
  { code: 'AST', name: 'Astrocaps' },
  { code: 'BA', name: 'Body Action Products' },
  { code: 'BB', name: 'Boy Butter Lubes' },
  { code: 'BC', name: 'Elbow Grease' },
  { code: 'BH', name: 'Beverly Hills Naughty Girl' },
  { code: 'BJ', name: 'BJ' },
  { code: 'BL', name: 'Blush Novelties' },
  { code: 'BLC', name: 'Ball and Chain' },
  { code: 'BMS', name: 'BMS Enterprises' },
  { code: 'BS', name: 'B Swish Toys' },
  { code: 'CB', name: 'CBX Male Chastity' },
  { code: 'CF', name: 'California Fantasies' },
  { code: 'CHA', name: 'Rascal Toys' },
  { code: 'CK', name: 'Cock Oil' },
  { code: 'CN', name: 'CURVE NOVELTIES' },
  { code: 'COM', name: 'ASTROGLIDE' },
  { code: 'COQ', name: 'Coquette Lingerie' },
  { code: 'COU', name: 'Cousins Group' },
  { code: 'CRE', name: 'Creative Conceptions' },
  { code: 'DAVE', name: 'D.A.V.E. / Synergy' },
  { code: 'DC', name: 'Dr Clockworks' },
  { code: 'DEN', name: 'Spunk Lube' },
  { code: 'DJ', name: 'Doc Johnson Novelties' },
  { code: 'DL', name: 'Doctor Love' },
  { code: 'DLB', name: 'Urine' },
  { code: 'DR', name: 'Dr. Joel Pumps' },
  { code: 'DRMG', name: 'Dream Girl Lingerie' },
  { code: 'DXP', name: 'Bathmate' },
  { code: 'EB', name: 'Earthly Body' },
  { code: 'EC', name: 'Erotic Chocolates' },
  { code: 'ECS', name: 'Trojan' },
  { code: 'EDC', name: 'EDC Wholesale' },
  { code: 'EL', name: 'Electric / Hustler Lingerie' },
  { code: 'ELM', name: 'Elegant Moments Lingerie' },
  { code: 'EMP', name: 'Empire Labs' },
  { code: 'EMS', name: 'Empire Smoke Distributor' },
  { code: 'EN', name: 'Evolved Novelties' },
  { code: 'EP', name: 'Gun Oil' },
  { code: 'EPS', name: 'EP Supply/Sexy Battery' },
  { code: 'EV', name: 'DAME' },
  { code: 'FAN', name: 'Fantasy Lingerie' },
  { code: 'FIN', name: 'Fukuoku Therapeutic Vibes' },
  { code: 'FM', name: 'FLINTTS MINTS' },
  { code: 'FOR', name: 'Forplay Lubricants' },
  { code: 'FRE', name: 'Odin Novelties' },
  { code: 'FSH', name: 'Fashioncraft' },
  { code: 'FULL', name: 'Savage Lingerie' },
  { code: 'GCL', name: 'Good Clean Love' },
  { code: 'GE', name: "George's Funfactory" },
  { code: 'GL', name: 'Don Wands / Glow' },
  { code: 'GLOB', name: 'TRUSTEX CONDOMS' },
  { code: 'GNV', name: 'Global Novelties' },
  { code: 'GRE', name: 'Assorted CBD Vendors' },
  { code: 'GT', name: 'Golden Triangle' },
  { code: 'GW', name: 'G World Intimates' },
  { code: 'HEL', name: 'Helmet Grease' },
  { code: 'HOTT', name: 'HOTT Products' },
  { code: 'HP', name: 'Classic Brands' },
  { code: 'ICB', name: 'Icon Brands' },
  { code: 'ID', name: 'ID Lube' },
  { code: 'IE', name: 'Intimate Earth' },
  { code: 'ILF', name: 'Fleshlight' },
  { code: 'JIM', name: 'Jimmy Jane' },
  { code: 'JO', name: 'System JO' },
  { code: 'KA', name: 'Kalan' },
  { code: 'KBCH', name: 'KBCH' },
  { code: 'KHE', name: 'Kheper Games' },
  { code: 'KIN', name: 'Kink Labs' },
  { code: 'KS', name: 'Kama Sutra' },
  { code: 'LE', name: 'Lelo' },
  { code: 'LH', name: 'Love Honey' },
  { code: 'LIN', name: 'Line One Condoms' },
  { code: 'LIT', name: 'Little Genie' },
  { code: 'LLF', name: 'Liquid Latex Fashions' },
  { code: 'LV', name: 'LV' },
  { code: 'MAL', name: 'Male Basics' },
  { code: 'MAX', name: 'Maxtasy' },
  { code: 'MBO', name: 'Assorted Books and Mags' },
  { code: 'MD', name: 'MD Science' },
  { code: 'ME', name: 'Male Edge' },
  { code: 'MET', name: 'MET' },
  { code: 'MIA', name: 'MIA' },
  { code: 'MP', name: 'Male Power Lingerie' },
  { code: 'MR', name: 'Male Rose' },
  { code: 'MS', name: 'Magic Silk Lingerie' },
  { code: 'MT', name: 'Maia Toys' },
  { code: 'NC', name: 'Nu Sensuelle' },
  { code: 'NO', name: 'Assorted Pill Vendors' },
  { code: 'NOF', name: 'Nori Fields Magic Gel' },
  { code: 'NSN', name: 'NS Novelties' },
  { code: 'NVM', name: 'Novum LLC' },
  { code: 'NW', name: 'Nasstoys' },
  { code: 'OB', name: "Olivia's Boudoir" },
  { code: 'OEJ', name: 'Our Erotic Journey' },
  { code: 'OMB', name: 'Ohmibod' },
  { code: 'OX', name: 'OXBALLS' },
  { code: 'OZ', name: 'Ozze Creations' },
  { code: 'PAR', name: 'Paradise Products' },
  { code: 'PAST', name: 'Pastease' },
  { code: 'PED', name: 'Perfect Dimensions' },
  { code: 'PER', name: 'Perfect Fit' },
  { code: 'PHS', name: 'PHS INTERNATIONAL' },
  { code: 'PIC', name: 'Picture Brite' },
  { code: 'PIPEDR', name: 'Pipedream Products' },
  { code: 'PJUR', name: 'PJUR Lubricants' },
  { code: 'PL', name: 'Pretty Love' },
  { code: 'PRO', name: 'Emotion Lotion' },
  { code: 'REN', name: 'RENE ROFE' },
  { code: 'RO', name: 'Rocks Off' },
  { code: 'ROCK', name: 'ROCK' },
  { code: 'ROM', name: 'Romantic Depot' },
  { code: 'SAT', name: 'Satisfyer' },
  { code: 'SAV', name: 'Vedo' },
  { code: 'SCR', name: 'Screaming O' },
  { code: 'SE', name: 'California Exotic Novelties' },
  { code: 'SEN', name: 'Sensuva' },
  { code: 'SG', name: 'Sixth Gear Distribution' },
  { code: 'SH', name: 'Shunga' },
  { code: 'SHE', name: 'Sex and Health Enthusiasts' },
  { code: 'SHT', name: 'SHOTS AMERICA' },
  { code: 'SI', name: 'Sinclair Products' },
  { code: 'SIN', name: 'SI Novelties' },
  { code: 'SL', name: 'SLiquid Lubricants' },
  { code: 'SOL', name: 'Sola' },
  { code: 'SP', name: 'Simpli Trading' },
  { code: 'SPART', name: 'Spartacus' },
  { code: 'SPFU', name: 'Sportfucker' },
  { code: 'SPO', name: 'Sport Lube' },
  { code: 'SS', name: 'Sport Sheets' },
  { code: 'ST', name: 'ST' },
  { code: 'SU', name: 'Sugar Sak' },
  { code: 'TAN', name: 'Tantus' },
  { code: 'TE', name: 'TENGA' },
  { code: 'TK', name: 'Tickle Kitty' },
  { code: 'TMN', name: 'Thank Me Now' },
  { code: 'TO', name: 'Topco' },
  { code: 'TU', name: 'Touche' },
  { code: 'VIB', name: 'Viben' },
  { code: 'VSI', name: 'Peekaboo' },
  { code: 'VT', name: 'Vibratex' },
  { code: 'VX', name: 'Vixen Creations' },
  { code: 'WAL', name: 'Slippery Stuff Lubes' },
  { code: 'WIC', name: 'Wicked Lubes' },
  { code: 'WL', name: 'Wet Lube' },
  { code: 'WOO', name: 'Wood Rocket' },
  { code: 'WTC', name: 'Cloud 9 Novelties' },
  { code: 'XG', name: 'X-Gen Products' },
  { code: 'XR', name: 'XR Brands' },
  { code: 'XXX', name: 'XXX' },
  { code: 'ZA', name: 'ZALO' },
  { code: 'ZAM', name: 'ZAM' },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const socketPath = '/Users/lorencouse/Library/Application Support/Local/run/MgtM6VLEi/mysql/mysqld.sock';
  const database = 'local';

  // Load existing manufacturers.json
  const manufacturersPath = join(process.cwd(), 'data', 'manufacturers.json');
  const existingData: ManufacturersData = JSON.parse(readFileSync(manufacturersPath, 'utf-8'));
  const existingCodes = new Set(existingData.manufacturers.map((m) => m.code));

  // Find the highest ID to continue from
  let maxId = Math.max(...existingData.manufacturers.map((m) => parseInt(m.id, 10)));

  // Find manufacturers to add
  const toAdd: Manufacturer[] = [];
  for (const xmlMfr of xmlManufacturers) {
    if (!existingCodes.has(xmlMfr.code)) {
      maxId++;
      toAdd.push({
        id: maxId.toString(),
        code: xmlMfr.code,
        name: xmlMfr.name,
        active: '1', // Mark as active since they're used in products
        video: '0',
      });
    } else {
      // Update name if different (in case XML has better name)
      const existing = existingData.manufacturers.find((m) => m.code === xmlMfr.code);
      if (existing && existing.name !== xmlMfr.name) {
        console.log(`Updating name for ${xmlMfr.code}: "${existing.name}" -> "${xmlMfr.name}"`);
        existing.name = xmlMfr.name;
        // Mark as active if it's in our products
        existing.active = '1';
      } else if (existing) {
        // Mark as active if it's in our products
        existing.active = '1';
      }
    }
  }

  console.log(`\nFound ${toAdd.length} new manufacturers to add`);
  console.log('New manufacturers:', toAdd.map((m) => `${m.code}: ${m.name}`).join('\n'));

  // Add new manufacturers to the data
  existingData.manufacturers.push(...toAdd);

  // Save updated manufacturers.json
  writeFileSync(manufacturersPath, JSON.stringify(existingData, null, 2));
  console.log('\nUpdated manufacturers.json');

  // Now import the new manufacturers to the database
  console.log('\nImporting manufacturers to database...');

  // Load existing manufacturer mapping
  const mappingPath = join(process.cwd(), 'data', 'manufacturer-mapping.json');
  let mapping: { codeToId: Record<string, number>; codeToSlug: Record<string, string>; lastUpdated: string };
  try {
    mapping = JSON.parse(readFileSync(mappingPath, 'utf-8'));
  } catch {
    mapping = { codeToId: {}, codeToSlug: {}, lastUpdated: '' };
  }

  // Get all manufacturers that need to be in DB (all from XML)
  const manufacturersToImport = xmlManufacturers.filter((m) => !mapping.codeToId[m.code]);
  console.log(`\n${manufacturersToImport.length} manufacturers need to be imported to DB`);

  if (manufacturersToImport.length === 0) {
    console.log('All manufacturers already in database');
    return;
  }

  // Import each manufacturer as a product_brand term
  for (const mfr of manufacturersToImport) {
    const slug = slugify(mfr.name);
    console.log(`Importing: ${mfr.code} - ${mfr.name} (slug: ${slug})`);

    // Insert into wp_terms
    const insertTermSql = `
      INSERT INTO wp_terms (name, slug, term_group)
      VALUES ('${mfr.name.replace(/'/g, "\\'")}', '${slug}', 0)
    `;

    try {
      execSync(
        `mysql --socket="${socketPath}" -u root ${database} -e "${insertTermSql}"`,
        { encoding: 'utf-8' }
      );

      // Get the term ID
      const getIdResult = execSync(
        `mysql --socket="${socketPath}" -u root ${database} -N -e "SELECT LAST_INSERT_ID()"`,
        { encoding: 'utf-8' }
      ).trim();
      const termId = parseInt(getIdResult, 10);

      // Insert into wp_term_taxonomy
      const insertTaxonomySql = `
        INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count)
        VALUES (${termId}, 'product_brand', '', 0, 0)
      `;
      execSync(
        `mysql --socket="${socketPath}" -u root ${database} -e "${insertTaxonomySql}"`,
        { encoding: 'utf-8' }
      );

      // Get the term_taxonomy_id
      const getTaxIdResult = execSync(
        `mysql --socket="${socketPath}" -u root ${database} -N -e "SELECT LAST_INSERT_ID()"`,
        { encoding: 'utf-8' }
      ).trim();
      const termTaxonomyId = parseInt(getTaxIdResult, 10);

      // Add meta for brand code
      const insertMetaSql = `
        INSERT INTO wp_termmeta (term_id, meta_key, meta_value)
        VALUES (${termId}, 'brand_code', '${mfr.code}')
      `;
      execSync(
        `mysql --socket="${socketPath}" -u root ${database} -e "${insertMetaSql}"`,
        { encoding: 'utf-8' }
      );

      // Update mapping
      mapping.codeToId[mfr.code] = termId;
      mapping.codeToSlug[mfr.code] = slug;

      console.log(`  -> term_id: ${termId}, term_taxonomy_id: ${termTaxonomyId}`);
    } catch (error) {
      console.error(`Error importing ${mfr.code}:`, error);
    }
  }

  // Save updated mapping
  mapping.lastUpdated = new Date().toISOString();
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log('\nUpdated manufacturer-mapping.json');

  // Count how many are now mapped
  const mappedCount = Object.keys(mapping.codeToId).length;
  console.log(`\nTotal manufacturers mapped: ${mappedCount}`);
}

main().catch(console.error);
