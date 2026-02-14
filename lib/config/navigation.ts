/**
 * Navigation Configuration
 *
 * Central configuration for all site navigation menus.
 * Used by both desktop dropdowns and mobile menu.
 */

export interface NavItem {
  label: string;
  href: string;
  description?: string;
  children?: NavItem[];
  icon?: string; // Icon key from CategoryIcons
  featured?: boolean; // Highlight in menu
}

export interface NavSection {
  label: string;
  href?: string;
  children: NavItem[];
  columns?: number; // For mega menu layout (1-4)
  featured?: NavItem[]; // Featured items shown separately
}

// Main navigation structure
export const mainNavigation: NavSection[] = [
  {
    label: 'Shop',
    href: '/shop',
    columns: 4,
    children: [
      {
        label: 'Sex Toys',
        href: '/sex-toys/sex-toys',
        children: [
          { label: 'Vibrators', href: '/sex-toys/vibrators', icon: 'vibrator' },
          { label: 'Dildos', href: '/sex-toys/dildos-dongs', icon: 'dildo' },
          { label: 'Anal Toys', href: '/sex-toys/anal-toys', icon: 'anal' },
          { label: 'Masturbators', href: '/sex-toys/masturbators', icon: 'masturbator' },
          { label: 'Cock Rings', href: '/sex-toys/cock-rings', icon: 'cockRing' },
        ],
      },
      {
        label: 'For Her',
        href: '/sex-toys/sextoys-for-women',
        children: [
          { label: 'Vibrators', href: '/sex-toys/vibrators', icon: 'vibrator' },
          { label: 'Clitoral', href: '/sex-toys/clitoral', icon: 'clitoral' },
          { label: 'G-Spot', href: '/sex-toys/g-spot', icon: 'gspot' },
          { label: 'Bullets & Eggs', href: '/sex-toys/vibrating-bullets-eggs', icon: 'bullet' },
          { label: 'Rabbit Style', href: '/sex-toys/rabbit-style-vibrators', icon: 'rabbit' },
        ],
      },
      {
        label: 'For Him',
        href: '/sex-toys/sextoys-for-men',
        children: [
          { label: 'Masturbators', href: '/sex-toys/masturbators', icon: 'masturbator' },
          { label: 'Cock Rings', href: '/sex-toys/cock-rings', icon: 'cockRing' },
          { label: 'Penis Pumps', href: '/sex-toys/penis-pumps', icon: 'pump' },
          { label: 'Prostate', href: '/sex-toys/prostate-massagers', icon: 'prostate' },
          { label: 'Extensions', href: '/sex-toys/penis-extensions', icon: 'forMen' },
        ],
      },
      {
        label: 'Bondage & Fetish',
        href: '/sex-toys/bondage-fetish-kink',
        children: [
          { label: 'Restraints', href: '/sex-toys/bondage-restraints', icon: 'bondage' },
          { label: 'Cuffs', href: '/sex-toys/cuffs', icon: 'cuffs' },
          { label: 'Whips & Paddles', href: '/sex-toys/whips-paddles-ticklers', icon: 'whip' },
          { label: 'Nipple Play', href: '/sex-toys/nipple-play', icon: 'nipple' },
          { label: 'Bondage Kits', href: '/sex-toys/bondage-kits-kinky-sets', icon: 'kit' },
        ],
      },
      {
        label: 'Lubricants',
        href: '/sex-toys/lubricants',
        children: [
          { label: 'Water-Based', href: '/sex-toys/water-based', icon: 'lubricant' },
          { label: 'Silicone-Based', href: '/sex-toys/silicone-based', icon: 'lubricant' },
          { label: 'Anal Lubes', href: '/sex-toys/anal-lubes-lotions-sprays-creams', icon: 'lubricant' },
          { label: 'Flavored', href: '/sex-toys/flavored', icon: 'lubricant' },
          { label: 'Massage', href: '/sex-toys/massage-lotions-creams', icon: 'massage' },
        ],
      },
      {
        label: 'Lingerie',
        href: '/sex-toys/lingerie-clothing',
        children: [
          { label: 'Stockings', href: '/sex-toys/stockings-pantyhose-garters', icon: 'stockings' },
          { label: "Women's", href: '/sex-toys/womens-underwear', icon: 'lingerie' },
          { label: "Men's", href: '/sex-toys/mens-underwear', icon: 'underwear' },
          { label: 'Costumes', href: '/sex-toys/sexy-costume-accessories', icon: 'lingerie' },
        ],
      },
      {
        label: 'For Couples',
        href: '/sex-toys/sextoys-for-couples',
        children: [
          { label: 'Couples Toys', href: '/sex-toys/sextoys-for-couples', icon: 'couples' },
          { label: 'Sensual Kits', href: '/sex-toys/sensual-kits', icon: 'kit' },
          { label: 'Games', href: '/sex-toys/adult-party-games', icon: 'partyGames' },
        ],
      },
      {
        label: 'Essentials',
        href: '/sex-toys/health-beauty',
        children: [
          { label: 'Condoms', href: '/sex-toys/condoms', icon: 'condom' },
          { label: 'Hygiene', href: '/sex-toys/hygiene-intimate-care', icon: 'hygiene' },
          { label: 'Wellness', href: '/sex-toys/health-beauty', icon: 'healthBeauty' },
        ],
      },
    ],
    featured: [
      { label: 'New Arrivals', href: '/shop?sort=date', featured: true },
      { label: 'Best Sellers', href: '/shop?sort=popularity', featured: true },
      { label: 'On Sale', href: '/shop?on_sale=true', featured: true },
    ],
  },
  {
    label: 'Guides',
    href: '/guides',
    columns: 2,
    children: [
      {
        label: 'Topics',
        href: '/guides',
        children: [
          { label: 'Sex & Intimacy', href: '/guides/category/sex', description: 'Tips and techniques' },
          { label: 'Relationships', href: '/guides/category/relationship', description: 'Connection advice' },
          { label: 'Health & Wellness', href: '/guides/category/health', description: 'Sexual health info' },
          { label: 'Product Guides', href: '/guides/category/guides', description: 'How-to guides' },
        ],
      },
      {
        label: 'Popular Guides',
        href: '/guides',
        children: [
          { label: 'Beginner\'s Guide to Toys', href: '/guides/best-male-sex-toys', featured: true },
          { label: 'Lube Guide', href: '/guides/best-lubes', featured: true },
          { label: 'Couples Play', href: '/guides/best-sex-toys-for-women', featured: true },
        ],
      },
    ],
  },
  {
    label: 'Help',
    href: '/faq',
    columns: 1,
    children: [
      {
        label: 'Customer Service',
        href: '/faq',
        children: [
          { label: 'FAQ', href: '/faq', description: 'Common questions' },
          { label: 'Shipping & Returns', href: '/shipping-returns', description: 'Delivery info' },
          { label: 'Contact Us', href: '/contact', description: 'Get in touch' },
          { label: 'Order Tracking', href: '/track-order', description: 'Track your order' },
        ],
      },
    ],
  },
];

// Simple top-level links (non-dropdown)
export const simpleNavLinks: NavItem[] = [
  { label: 'About', href: '/about' },
];

// Utility links for footer/mobile
export const utilityLinks: NavItem[] = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Shipping & Returns', href: '/shipping-returns' },
  { label: 'Contact', href: '/contact' },
];

// Account navigation
export const accountNavigation: NavItem[] = [
  { label: 'Dashboard', href: '/account' },
  { label: 'Orders', href: '/account/orders' },
  { label: 'Addresses', href: '/account/addresses' },
  { label: 'Account Details', href: '/account/details' },
  { label: 'Wishlist', href: '/account/wishlist' },
];
