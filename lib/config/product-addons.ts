/**
 * Product Addons Configuration
 *
 * Defines addon products that can be offered with eligible product categories.
 * These are complementary products shown as checkboxes on the product page.
 */

export interface AddonProduct {
  id: string;
  /** WooCommerce product database ID */
  productId: string;
  sku: string;
  /** Product slug for linking to product page */
  slug: string;
  name: string;
  shortName: string;
  /** Regular price */
  regularPrice: number;
  /** Addon price (discounted) */
  price: number;
  /** Price when purchased as part of bundle */
  bundlePrice: number;
  description?: string;
  /** Product image URL */
  image?: string;
}

export interface AddonBundle {
  id: string;
  /** WooCommerce product database ID for the bundle product */
  productId: string;
  /** Bundle product SKU */
  sku: string;
  /** Product slug for linking */
  slug: string;
  name: string;
  shortName: string;
  price: number;
  /** Regular price (sum of individual items) */
  regularPrice: number;
  description?: string;
  /** SKUs included in this bundle (for reference) */
  includes: string[];
  /** Savings compared to buying individually */
  savings: number;
  /** Product image URL */
  image?: string;
}

/**
 * Individual addon products
 *
 * NOTE: Update productId values with actual WooCommerce database IDs
 * You can find these in WooCommerce admin or by querying the API
 */
export const ADDON_PRODUCTS: AddonProduct[] = [
  {
    id: 'addon-toy-cleaner',
    productId: '204147',
    sku: '716770030474',
    slug: 'universal-toy-cleaner-4-3-oz',
    name: 'Universal Toy Cleaner 4.3 oz',
    shortName: 'Toy Cleaner',
    regularPrice: 19.97,
    price: 14.97,
    bundlePrice: 11.22,
    description: 'Keep your toys hygienic and safe',
    image:
      '/wp-content/uploads/2026/01/universal-toy-cleaner-43-oz-1-6c6e89b5.webp',
  },
  {
    id: 'addon-anal-lube',
    productId: '193514',
    sku: '827160112158',
    slug: 'pjur-analyse-me-anal-water-base',
    name: 'Pjur Analyse Me Anal Water Base',
    shortName: 'Anal Lube',
    regularPrice: 34.97,
    price: 29.97,
    bundlePrice: 22.47,
    description: 'Premium water-based anal lubricant',
    image:
      '/wp-content/uploads/2026/01/pjur-analyse-me-anal-water-base-100ml-34-oz--1.webp',
  },
  {
    id: 'addon-enema',
    productId: '205407',
    sku: '685239852653',
    slug: 'cloud-9-fresh-deluxe-anal-soft-tip-enema-douche-7-6-oz-w-ez-squeeze-bulb-2-c-rings',
    name: 'Cloud 9 Fresh Deluxe Anal Enema Douche',
    shortName: 'Enema',
    regularPrice: 19.97,
    price: 14.97,
    bundlePrice: 11.22,
    description: 'For comfortable preparation',
    image:
      '/wp-content/uploads/2026/01/cloud-9-fresh-deluxe-anal-soft-tip-enema-douche-76-1-3e54ffbd.webp',
  },
];

/**
 * Bundle that includes all addon products
 *
 * NOTE: Update productId with actual WooCommerce product ID if bundle exists as a product
 */
export const ADDON_BUNDLE: AddonBundle = {
  id: 'addon-bundle-all',
  productId: '0', // TODO: Update with actual WooCommerce product ID if exists
  sku: 'CARE-KIT-BUNDLE',
  slug: 'complete-care-kit', // TODO: Update with actual product slug if exists
  name: 'Complete Care Kit (Cleaner, Lube, & Enema)',
  shortName: 'Complete Care Kit',
  price: 49.91,
  regularPrice: 74.91, // Sum of individual regular prices ($19.97 + $34.97 + $19.97)
  description:
    'Cleaner, Lube, & Enema - Everything you need for the best experience',
  includes: ['716770030474', '827160112158', '685239852653'],
  savings: 15.0, // $59.91 addon total - $44.91 bundle
};

/**
 * Category slugs that should show addon options
 * Includes parent categories - products in subcategories will also show addons
 */
export const ADDON_ELIGIBLE_CATEGORY_SLUGS: string[] = [
  // Vibrators and subcategories
  'vibrators',
  'novelty-vibrators',
  'classic-vibrators',
  'tongue-vibrators',
  'rabbit-style-vibrators',
  'bullets-eggs',
  'hands-free-strap-on-vibes',
  'realistic',
  'g-spot',
  'vibrator-kits',
  'rechargeable-vibrators',
  'magic-wands-body-massagers',
  'eco-friendly-sex-toys',
  'finger-vibrators',
  'vibrator-sleeves',
  'clitoral',
  'discreet-vibrators',
  'palm-size-massagers',
  'dildo-dong-kits',
  'giant-vibrators',
  'rocket-style-vibrators',
  'flexible-vibrators',
  'firm-vibrators',
  'clit-cuddlers',
  'g-spot-firm-vibrators',
  'g-spot-bullets-eggs',
  'g-spot-clit-stimulators',
  'g-spot-rabbit-style',
  'g-spot-flexible-vibrators',
  'glass-vibrators',
  'straight-vibrators-with-sleeves',
  'dual-bullets-eggs',
  'bullet-wands',
  'one-touch-bullets',

  // Dildos & Dongs and subcategories
  'dildos-dongs',
  'realistic-small-medium',
  'double-dongs',
  'realistic-large',
  'g-spot',
  'porn-star-molded-dildos',
  'unnatural-dildos-dongs',
  'inflating-ejaculating-dongs',
  'clone-your-own',
  'glass-dildos-dongs',
  'dildos-dongs-realistic',

  // Anal Toys and subcategories
  'anal-toys',
  'anal-beads',
  'prostate-massagers-p-spot-stimulators',
  'probes-sticks-rods',
  'anal',
  'anal-trainer-kits',
  'small-medium-butt-plugs',
  'large-huge-butt-plugs',
  'inflatable-butt-plugs',
  't-plugs',
  'prostate-massagers',
];

/**
 * Category IDs that should show addon options (numeric codes from WooCommerce)
 * This is an alternative way to match categories by database ID
 */
export const ADDON_ELIGIBLE_CATEGORY_IDS: number[] = [
  // Vibrators (3) and subcategories (excluding love-rings: 682)
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 33, 239, 252, 378, 476, 374, 749,
  666, 649, 745, 758, 759, 746, 747, 748, 750, 752, 507, 662, 665, 660, 651,

  // Dildos & Dongs (30) and subcategories
  30, 31, 32, 35, 255, 344, 591, 592, 617, 505, 815,

  // Anal Toys (36) and subcategories (excluding: 40=douches/enemas, 475=anal-lubes)
  36,
  38, 39, 41, 201, 467, 470, 471, 473, 775, 387,
];

/**
 * Category slugs that should NEVER show addon options (takes priority over eligible list)
 */
export const ADDON_EXCLUDED_CATEGORY_SLUGS: string[] = [
  'love-rings',
  'anal-douches-enemas-hygiene',
  'anal-lubes-lotions-sprays-creams',
];

/**
 * Category IDs that should NEVER show addon options
 */
export const ADDON_EXCLUDED_CATEGORY_IDS: number[] = [
  682, // love-rings
  40, // anal-douches-enemas-hygiene
  475, // anal-lubes-lotions-sprays-creams
];

/**
 * Categories that override the love-rings exclusion
 * If a love-rings product also has one of these categories, show addons
 */
const LOVE_RINGS_OVERRIDE_SLUGS: string[] = ['dildos-dongs', 'anal-toys'];
const LOVE_RINGS_OVERRIDE_IDS: number[] = [30, 36]; // dildos-dongs, anal-toys

/**
 * Check if a product's categories include any addon-eligible category
 */
export function isAddonEligible(categoryIds: number[]): boolean {
  const hasLoveRings = categoryIds.includes(682);
  const hasOverrideCategory = categoryIds.some((id) =>
    LOVE_RINGS_OVERRIDE_IDS.includes(id),
  );

  // Check for hard exclusions (not love-rings, or love-rings without override)
  const isHardExcluded = categoryIds.some((id) => {
    // anal-douches and anal-lubes are always excluded
    if (id === 40 || id === 475) return true;
    // love-rings is excluded unless product also has dildos-dongs or anal-toys
    if (id === 682 && !hasOverrideCategory) return true;
    return false;
  });

  if (isHardExcluded) return false;

  return categoryIds.some((id) => ADDON_ELIGIBLE_CATEGORY_IDS.includes(id));
}

/**
 * Check if a product's category slugs include any addon-eligible category
 */
export function isAddonEligibleBySlug(categorySlugs: string[]): boolean {
  const normalizedSlugs = categorySlugs.map((slug) => slug.toLowerCase());

  const hasLoveRings = normalizedSlugs.includes('love-rings');
  const hasOverrideCategory = normalizedSlugs.some((slug) =>
    LOVE_RINGS_OVERRIDE_SLUGS.includes(slug),
  );

  // Check for hard exclusions (not love-rings, or love-rings without override)
  const isHardExcluded = normalizedSlugs.some((slug) => {
    // anal-douches and anal-lubes are always excluded
    if (slug === 'anal-douches-enemas-hygiene') return true;
    if (slug === 'anal-lubes-lotions-sprays-creams') return true;
    // love-rings is excluded unless product also has dildos-dongs or anal-toys
    if (slug === 'love-rings' && !hasOverrideCategory) return true;
    return false;
  });

  if (isHardExcluded) return false;

  return normalizedSlugs.some((slug) =>
    ADDON_ELIGIBLE_CATEGORY_SLUGS.includes(slug),
  );
}

/**
 * Calculate total price for selected addons
 */
export function calculateAddonsTotal(
  selectedAddonIds: string[],
  includeBundle: boolean,
): number {
  if (includeBundle) {
    return ADDON_BUNDLE.price;
  }

  return ADDON_PRODUCTS.filter((addon) =>
    selectedAddonIds.includes(addon.id),
  ).reduce((total, addon) => total + addon.price, 0);
}

/**
 * Get addon product by ID
 */
export function getAddonById(id: string): AddonProduct | undefined {
  return ADDON_PRODUCTS.find((addon) => addon.id === id);
}
