/**
 * Navigation Configuration
 *
 * Central configuration for all site navigation menus.
 * Used by both desktop dropdowns and mobile menu.
 *
 * Labels live in messages/{en,es}.json under the `nav` namespace; this file
 * stores translation key references (labelKey/descriptionKey) plus the
 * locale-agnostic structure (href, icon, hierarchy). Components resolve
 * labels at render time via useTranslations('nav').
 */

export interface NavItem {
  /** Translation key under nav.* (resolved at render time). */
  labelKey: string;
  href: string;
  /** Optional description translation key (used in dropdown subtitles). */
  descriptionKey?: string;
  children?: NavItem[];
  icon?: string; // Icon key from CategoryIcons
  featured?: boolean; // Highlight in menu
}

export interface NavSection {
  labelKey: string;
  href?: string;
  children: NavItem[];
  columns?: number; // For mega menu layout (1-4)
  featured?: NavItem[]; // Featured items shown separately
}

// Main navigation structure
export const mainNavigation: NavSection[] = [
  {
    labelKey: 'shop.heading',
    href: '/shop',
    columns: 4,
    children: [
      {
        labelKey: 'shop.sexToysHeading',
        href: '/sex-toys/sex-toys',
        children: [
          { labelKey: 'shop.sexToysVibrators', href: '/sex-toys/vibrators', icon: 'vibrator' },
          { labelKey: 'shop.sexToysDildos', href: '/sex-toys/dildos-dongs', icon: 'dildo' },
          { labelKey: 'shop.sexToysAnal', href: '/sex-toys/anal-toys', icon: 'anal' },
          { labelKey: 'shop.sexToysMasturbators', href: '/sex-toys/masturbators', icon: 'masturbator' },
          { labelKey: 'shop.sexToysCockRings', href: '/sex-toys/cock-rings', icon: 'cockRing' },
        ],
      },
      {
        labelKey: 'shop.forHerHeading',
        href: '/sex-toys/sextoys-for-women',
        children: [
          { labelKey: 'shop.forHerVibrators', href: '/sex-toys/vibrators', icon: 'vibrator' },
          { labelKey: 'shop.forHerClitoral', href: '/sex-toys/clitoral', icon: 'clitoral' },
          { labelKey: 'shop.forHerGSpot', href: '/sex-toys/g-spot', icon: 'gspot' },
          { labelKey: 'shop.forHerBullets', href: '/sex-toys/vibrating-bullets-eggs', icon: 'bullet' },
          { labelKey: 'shop.forHerRabbit', href: '/sex-toys/rabbit-style-vibrators', icon: 'rabbit' },
        ],
      },
      {
        labelKey: 'shop.forHimHeading',
        href: '/sex-toys/sextoys-for-men',
        children: [
          { labelKey: 'shop.forHimMasturbators', href: '/sex-toys/masturbators', icon: 'masturbator' },
          { labelKey: 'shop.forHimCockRings', href: '/sex-toys/cock-rings', icon: 'cockRing' },
          { labelKey: 'shop.forHimPumps', href: '/sex-toys/penis-pumps', icon: 'pump' },
          { labelKey: 'shop.forHimProstate', href: '/sex-toys/prostate-massagers', icon: 'prostate' },
          { labelKey: 'shop.forHimExtensions', href: '/sex-toys/penis-extensions', icon: 'forMen' },
        ],
      },
      {
        labelKey: 'shop.bondageHeading',
        href: '/sex-toys/bondage-fetish-kink',
        children: [
          { labelKey: 'shop.bondageRestraints', href: '/sex-toys/bondage-restraints', icon: 'bondage' },
          { labelKey: 'shop.bondageCuffs', href: '/sex-toys/cuffs', icon: 'cuffs' },
          { labelKey: 'shop.bondageWhips', href: '/sex-toys/whips-paddles-ticklers', icon: 'whip' },
          { labelKey: 'shop.bondageNipple', href: '/sex-toys/nipple-play', icon: 'nipple' },
          { labelKey: 'shop.bondageKits', href: '/sex-toys/bondage-kits-kinky-sets', icon: 'kit' },
        ],
      },
      {
        labelKey: 'shop.lubeHeading',
        href: '/sex-toys/lubricants',
        children: [
          { labelKey: 'shop.lubeWater', href: '/sex-toys/water-based', icon: 'lubricant' },
          { labelKey: 'shop.lubeSilicone', href: '/sex-toys/silicone-based', icon: 'lubricant' },
          { labelKey: 'shop.lubeAnal', href: '/sex-toys/anal-lubes-lotions-sprays-creams', icon: 'lubricant' },
          { labelKey: 'shop.lubeFlavored', href: '/sex-toys/flavored', icon: 'lubricant' },
          { labelKey: 'shop.lubeMassage', href: '/sex-toys/massage-lotions-creams', icon: 'massage' },
        ],
      },
      {
        labelKey: 'shop.lingerieHeading',
        href: '/sex-toys/lingerie-clothing',
        children: [
          { labelKey: 'shop.lingerieStockings', href: '/sex-toys/stockings-pantyhose-garters', icon: 'stockings' },
          { labelKey: 'shop.lingerieWomens', href: '/sex-toys/womens-underwear', icon: 'lingerie' },
          { labelKey: 'shop.lingerieMens', href: '/sex-toys/mens-underwear', icon: 'underwear' },
          { labelKey: 'shop.lingerieCostumes', href: '/sex-toys/sexy-costume-accessories', icon: 'lingerie' },
        ],
      },
      {
        labelKey: 'shop.couplesHeading',
        href: '/sex-toys/sextoys-for-couples',
        children: [
          { labelKey: 'shop.couplesToys', href: '/sex-toys/sextoys-for-couples', icon: 'couples' },
          { labelKey: 'shop.couplesKits', href: '/sex-toys/sensual-kits', icon: 'kit' },
          { labelKey: 'shop.couplesGames', href: '/sex-toys/adult-party-games', icon: 'partyGames' },
        ],
      },
      {
        labelKey: 'shop.essentialsHeading',
        href: '/sex-toys/health-beauty',
        children: [
          { labelKey: 'shop.essentialsCondoms', href: '/sex-toys/condoms', icon: 'condom' },
          { labelKey: 'shop.essentialsHygiene', href: '/sex-toys/hygiene-intimate-care', icon: 'hygiene' },
          { labelKey: 'shop.essentialsWellness', href: '/sex-toys/health-beauty', icon: 'healthBeauty' },
        ],
      },
    ],
    featured: [
      { labelKey: 'shop.featuredNewArrivals', href: '/shop?sort=newest', featured: true },
      { labelKey: 'shop.featuredBestSellers', href: '/shop?sort=popularity', featured: true },
      { labelKey: 'shop.featuredOnSale', href: '/shop?onSale=true', featured: true },
    ],
  },
  {
    labelKey: 'guides.heading',
    href: '/guides',
    columns: 2,
    children: [
      {
        labelKey: 'guides.topicsHeading',
        href: '/guides',
        children: [
          { labelKey: 'guides.topicsSex', href: '/guides/category/sex', descriptionKey: 'guides.topicsSexDesc' },
          { labelKey: 'guides.topicsRelationships', href: '/guides/category/relationship', descriptionKey: 'guides.topicsRelationshipsDesc' },
          { labelKey: 'guides.topicsHealth', href: '/guides/category/health', descriptionKey: 'guides.topicsHealthDesc' },
          { labelKey: 'guides.topicsProductGuides', href: '/guides/category/guides', descriptionKey: 'guides.topicsProductGuidesDesc' },
        ],
      },
      {
        labelKey: 'guides.popularHeading',
        href: '/guides',
        children: [
          { labelKey: 'guides.popularBeginner', href: '/guides/best-male-sex-toys', featured: true },
          { labelKey: 'guides.popularLube', href: '/guides/best-lubes', featured: true },
          { labelKey: 'guides.popularCouples', href: '/guides/best-sex-toys-for-women', featured: true },
        ],
      },
    ],
  },
  {
    labelKey: 'help.heading',
    href: '/faq',
    columns: 1,
    children: [
      {
        labelKey: 'help.customerServiceHeading',
        href: '/faq',
        children: [
          { labelKey: 'help.faq', href: '/faq', descriptionKey: 'help.faqDesc' },
          { labelKey: 'help.shipping', href: '/shipping-returns', descriptionKey: 'help.shippingDesc' },
          { labelKey: 'help.contact', href: '/contact', descriptionKey: 'help.contactDesc' },
          { labelKey: 'help.tracking', href: '/track-order', descriptionKey: 'help.trackingDesc' },
        ],
      },
    ],
  },
];

// Simple top-level links (non-dropdown)
export const simpleNavLinks: NavItem[] = [
  { labelKey: 'simple.about', href: '/about' },
];

// Utility links for footer/mobile
export const utilityLinks: NavItem[] = [
  { labelKey: 'utility.privacy', href: '/privacy' },
  { labelKey: 'utility.terms', href: '/terms' },
  { labelKey: 'utility.shipping', href: '/shipping-returns' },
  { labelKey: 'utility.contact', href: '/contact' },
];

// Account navigation — labels resolved against the `account.nav.*`
// namespace already established by AccountLayout's sidebar. Keep this in
// sync if you change the sidebar key list.
export const accountNavigation: NavItem[] = [
  { labelKey: 'dashboard', href: '/account' },
  { labelKey: 'orders', href: '/account/orders' },
  { labelKey: 'addresses', href: '/account/addresses' },
  { labelKey: 'accountDetails', href: '/account/details' },
  { labelKey: 'wishlist', href: '/account/wishlist' },
];
