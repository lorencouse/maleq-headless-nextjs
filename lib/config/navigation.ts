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
        href: '/product-category/sex-toys',
        children: [
          { label: 'Vibrators', href: '/product-category/vibrators', icon: 'vibrator' },
          { label: 'Dildos', href: '/product-category/dildos-dongs', icon: 'dildo' },
          { label: 'Anal Toys', href: '/product-category/anal-toys', icon: 'anal' },
          { label: 'Masturbators', href: '/product-category/masturbators', icon: 'masturbator' },
          { label: 'Cock Rings', href: '/product-category/cock-rings', icon: 'cockRing' },
        ],
      },
      {
        label: 'For Her',
        href: '/product-category/sextoys-for-women',
        children: [
          { label: 'Vibrators', href: '/product-category/vibrators', icon: 'vibrator' },
          { label: 'Clitoral', href: '/product-category/clitoral', icon: 'clitoral' },
          { label: 'G-Spot', href: '/product-category/g-spot', icon: 'gspot' },
          { label: 'Bullets & Eggs', href: '/product-category/vibrating-bullets-eggs', icon: 'bullet' },
          { label: 'Rabbit Style', href: '/product-category/rabbit-style-vibrators', icon: 'rabbit' },
        ],
      },
      {
        label: 'For Him',
        href: '/product-category/sextoys-for-men',
        children: [
          { label: 'Masturbators', href: '/product-category/masturbators', icon: 'masturbator' },
          { label: 'Cock Rings', href: '/product-category/cock-rings', icon: 'cockRing' },
          { label: 'Penis Pumps', href: '/product-category/penis-pumps', icon: 'pump' },
          { label: 'Prostate', href: '/product-category/prostate-massagers', icon: 'prostate' },
          { label: 'Extensions', href: '/product-category/penis-extensions', icon: 'forMen' },
        ],
      },
      {
        label: 'Bondage & Fetish',
        href: '/product-category/bondage-fetish-kink',
        children: [
          { label: 'Restraints', href: '/product-category/bondage-restraints', icon: 'bondage' },
          { label: 'Cuffs', href: '/product-category/cuffs', icon: 'cuffs' },
          { label: 'Whips & Paddles', href: '/product-category/whips-paddles-ticklers', icon: 'whip' },
          { label: 'Nipple Play', href: '/product-category/nipple-play', icon: 'nipple' },
          { label: 'Bondage Kits', href: '/product-category/bondage-kits-kinky-sets', icon: 'kit' },
        ],
      },
      {
        label: 'Lubricants',
        href: '/product-category/lubricants',
        children: [
          { label: 'Water-Based', href: '/product-category/water-based', icon: 'lubricant' },
          { label: 'Silicone-Based', href: '/product-category/silicone-based', icon: 'lubricant' },
          { label: 'Anal Lubes', href: '/product-category/anal-lubes-lotions-sprays-creams', icon: 'lubricant' },
          { label: 'Flavored', href: '/product-category/flavored', icon: 'lubricant' },
          { label: 'Massage', href: '/product-category/massage-lotions-creams', icon: 'massage' },
        ],
      },
      {
        label: 'Lingerie',
        href: '/product-category/lingerie-clothing',
        children: [
          { label: 'Stockings', href: '/product-category/stockings-pantyhose-garters', icon: 'stockings' },
          { label: "Women's", href: '/product-category/womens-underwear', icon: 'lingerie' },
          { label: "Men's", href: '/product-category/mens-underwear', icon: 'underwear' },
          { label: 'Costumes', href: '/product-category/sexy-costume-accessories', icon: 'lingerie' },
        ],
      },
      {
        label: 'For Couples',
        href: '/product-category/sextoys-for-couples',
        children: [
          { label: 'Couples Toys', href: '/product-category/sextoys-for-couples', icon: 'couples' },
          { label: 'Sensual Kits', href: '/product-category/sensual-kits', icon: 'kit' },
          { label: 'Games', href: '/product-category/adult-party-games', icon: 'partyGames' },
        ],
      },
      {
        label: 'Essentials',
        href: '/product-category/health-beauty',
        children: [
          { label: 'Condoms', href: '/product-category/condoms', icon: 'condom' },
          { label: 'Hygiene', href: '/product-category/hygiene-intimate-care', icon: 'hygiene' },
          { label: 'Wellness', href: '/product-category/health-beauty', icon: 'healthBeauty' },
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
          { label: 'Beginner\'s Guide to Toys', href: '/guides/beginners-guide', featured: true },
          { label: 'Lube Guide', href: '/guides/lube-guide', featured: true },
          { label: 'Couples Play', href: '/guides/couples-guide', featured: true },
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
          { label: 'Order Tracking', href: '/account/orders', description: 'Track your order' },
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
