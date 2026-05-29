/**
 * Static decision tree for the support chatbot's guided mode.
 *
 * The widget walks this tree from the root with pill buttons. Leaf nodes are
 * either canned `answer` markdown or an `escalate` jump into the LLM-backed
 * free-text chat. Free-text input is hidden until the user explicitly
 * escalates — this lets us serve the bulk of common questions without
 * hitting the API.
 *
 * i18n: the `label`/`answer`/`transition` strings below are the English
 * source of truth, the analytics labels, and the runtime fallback. Localized
 * versions live in the message catalogs under `chat.tree`, keyed by each
 * node's id-PATH (e.g. `orders.track-order.answer`); ChatWidget resolves them
 * with t.has() + fallback to these literals. `id`, `type`, and `query` are
 * language-agnostic and must stay stable (ids anchor the catalog keys; query
 * feeds the English-keyed product index).
 */

export type TreeNode =
  | {
      id: string;
      label: string;
      type: 'category';
      children: TreeNode[];
    }
  | {
      id: string;
      label: string;
      type: 'answer';
      answer: string;
    }
  | {
      id: string;
      label: string;
      type: 'escalate';
      /** Greeting shown when transitioning into AI mode. */
      transition: string;
      /** Optional hint prepended to the user's first AI message for context. */
      contextHint?: string;
    }
  | {
      id: string;
      label: string;
      type: 'product-finder';
      /** Search keywords used for both product and blog lookup. */
      query: string;
    };

export const DECISION_TREE: TreeNode[] = [
  {
    id: 'orders',
    label: 'Orders & Tracking',
    type: 'category',
    children: [
      {
        id: 'track-order',
        label: "Where's my order?",
        type: 'answer',
        answer:
          "You can check your order two ways:\n\n- Account holders: [view your orders](/account/orders)\n- Guest checkout: use [order tracking](/track-order) with your order ID and the email from checkout\n\nFull tracking is provided on express shipping. Free and economy shipping may not include detailed tracking.",
      },
      {
        id: 'multiple-packages',
        label: 'My order arrived in multiple packages',
        type: 'answer',
        answer:
          "That's normal, we ship from multiple warehouses across the US, so larger orders can arrive in separate packages. If you haven't received everything by the end of the estimated delivery window, [contact us](/contact) with your order number.",
      },
      {
        id: 'cancel-order',
        label: 'Cancel my order',
        type: 'answer',
        answer:
          "Orders are processed throughout the day, so we can only cancel orders that haven't shipped yet. [Contact us](/contact) immediately with your order number to attempt a cancellation. Already-shipped packages can't be recalled.",
      },
      {
        id: 'damaged-or-wrong',
        label: 'Item arrived broken or wrong',
        type: 'answer',
        answer:
          "Sorry about that, we'll credit or replace defective items and fix any shipping mistakes. [Contact us](/contact) with:\n\n- Your order number\n- A short description of the issue\n- Photos of the damage\n- Keep all packaging materials",
      },
    ],
  },
  {
    id: 'shipping',
    label: 'Shipping & Delivery',
    type: 'category',
    children: [
      {
        id: 'shipping-times',
        label: 'How long does shipping take?',
        type: 'answer',
        answer:
          "Shipping times vary by tier, estimates appear next to each option at checkout and on your receipt. All times are in business days (no weekends or holidays), based on UPS/USPS estimates. See [Shipping & Returns](/shipping-returns) for details.",
      },
      {
        id: 'international',
        label: 'Do you ship internationally?',
        type: 'answer',
        answer:
          "Yes, we ship to many countries worldwide. International options and estimates appear at checkout. If your international order doesn't arrive within the estimated window, we'll cover the difference to the next shipping tier.",
      },
      {
        id: 'discreet',
        label: 'Is shipping discreet?',
        type: 'answer',
        answer:
          "Yes. All items ship in plain, unmarked packaging with no indication of contents. The sender appears as **CNV** or **TMQ**. For international customs, items are declared as \"Health Equipment\", \"Cosmetic\", or \"Gift\". More on the [Shipping & Returns page](/shipping-returns).",
      },
      {
        id: 'tracking-number',
        label: 'Will I get a tracking number?',
        type: 'answer',
        answer:
          "Express shipping includes full tracking. Free and economy shipping may not include detailed tracking. You can always check status via [your account](/account/orders) or [order tracking](/track-order).",
      },
      {
        id: 'billing-statement',
        label: 'What name appears on my statement?',
        type: 'answer',
        answer:
          "Purchases appear as **TMQ LLC** on your debit or credit card statement. We never reveal what was purchased on the statement itself.",
      },
    ],
  },
  {
    id: 'returns',
    label: 'Returns & Refunds',
    type: 'category',
    children: [
      {
        id: 'return-policy',
        label: 'What is your return policy?',
        type: 'answer',
        answer:
          "For sanitary reasons, **all sales are final**. We provide refunds or replacements only for:\n\n- Items sent in error\n- Items damaged on arrival\n\nInspect items promptly. Full policy on [Shipping & Returns](/shipping-returns).",
      },
      {
        id: 'damaged-return',
        label: 'My item arrived damaged',
        type: 'answer',
        answer:
          "We'll credit or replace it. [Contact us](/contact) with your order number, photos of the damage, and keep all packaging materials.",
      },
      {
        id: 'bounced-package',
        label: 'My package was refused or returned',
        type: 'answer',
        answer:
          "Bounced, undeliverable, or refused shipments are subject to a 10% restocking fee. Shipping fees on already-sent items are non-refundable.",
      },
    ],
  },
  {
    id: 'payment',
    label: 'Payment & Billing',
    type: 'category',
    children: [
      {
        id: 'payment-methods',
        label: 'What payment methods do you accept?',
        type: 'answer',
        answer:
          "All major credit cards (Visa, MasterCard, American Express, Discover), Apple Pay, and Google Pay, all through our Stripe-powered checkout.",
      },
      {
        id: 'payment-plans',
        label: 'Do you offer payment plans?',
        type: 'answer',
        answer:
          "Yes, Afterpay and Klarna are available at checkout for qualifying orders, letting you split purchases into interest-free installments. They appear automatically during checkout.",
      },
      {
        id: 'declined',
        label: 'My payment was declined',
        type: 'answer',
        answer:
          "Common reasons: incorrect card info, insufficient funds, or your bank's fraud protection. Verify your details and try again, or call your bank. If you keep hitting issues, [contact us](/contact).",
      },
      {
        id: 'international-currency',
        label: 'Do you accept international currencies?',
        type: 'answer',
        answer:
          "Yes. Prices are listed in USD; your bank charges in your local currency at their exchange rate. They may add international transaction fees, check with your bank for specifics.",
      },
      {
        id: 'payment-secure',
        label: 'Is my payment info secure?',
        type: 'answer',
        answer:
          "Yes. We use industry-standard SSL encryption and Stripe handles all payment processing (PCI-compliant). We never store your full credit card information on our servers.",
      },
    ],
  },
  {
    id: 'account',
    label: 'Account & Login',
    type: 'category',
    children: [
      {
        id: 'reset-password',
        label: 'I forgot my password',
        type: 'answer',
        answer:
          "Head to [Forgot Password](/forgot-password), enter your email, and we'll send a reset link. Check your spam folder if it doesn't show up in a few minutes.",
      },
      {
        id: 'need-account',
        label: 'Do I need an account?',
        type: 'answer',
        answer:
          "Nope, guest checkout works fine. An account gets you order history, saved addresses, wishlists, and easier tracking. [Register here](/register) if you'd like one.",
      },
      {
        id: 'coupon',
        label: 'How do I use a coupon code?',
        type: 'answer',
        answer:
          "Enter the code in the field on the [cart page](/cart) or during checkout, then click **Apply**. Only one coupon per order.",
      },
    ],
  },
  {
    id: 'product-help',
    label: 'Find a product / recommendations',
    type: 'category',
    children: [
      {
        id: 'audience-male',
        label: 'For him',
        type: 'category',
        children: [
          { id: 'cock-rings', label: 'Cock rings', type: 'product-finder', query: 'cock ring' },
          { id: 'prostate', label: 'Prostate massagers', type: 'product-finder', query: 'prostate' },
          { id: 'masturbators', label: 'Masturbators & strokers', type: 'product-finder', query: 'masturbator stroker' },
          { id: 'penis-pumps', label: 'Penis pumps', type: 'product-finder', query: 'penis pump' },
          { id: 'sleeves', label: 'Sleeves & extensions', type: 'product-finder', query: 'penis sleeve extension' },
        ],
      },
      {
        id: 'audience-female',
        label: 'For her',
        type: 'category',
        children: [
          { id: 'clit-vibes', label: 'Clitoral vibrators', type: 'product-finder', query: 'clitoral vibrator' },
          { id: 'gspot', label: 'G-spot toys', type: 'product-finder', query: 'g-spot' },
          { id: 'rabbits', label: 'Rabbit vibrators', type: 'product-finder', query: 'rabbit vibrator' },
          { id: 'suction', label: 'Suction / air pulse', type: 'product-finder', query: 'suction air pulse clitoral' },
          { id: 'wands', label: 'Wand massagers', type: 'product-finder', query: 'wand massager' },
        ],
      },
      {
        id: 'audience-universal',
        label: 'Universal / couples',
        type: 'category',
        children: [
          { id: 'anal', label: 'Anal toys', type: 'product-finder', query: 'anal' },
          { id: 'dildos', label: 'Dildos', type: 'product-finder', query: 'dildo' },
          { id: 'bondage', label: 'Bondage & BDSM', type: 'product-finder', query: 'bondage bdsm restraint' },
          { id: 'strapons', label: 'Strap-ons & harnesses', type: 'product-finder', query: 'strap-on harness' },
          { id: 'lube', label: 'Lubricants', type: 'product-finder', query: 'lubricant' },
          { id: 'condoms', label: 'Condoms', type: 'product-finder', query: 'condom' },
        ],
      },
    ],
  },
  {
    id: 'care',
    label: 'Product care & compatibility',
    type: 'category',
    children: [
      {
        id: 'cleaning',
        label: 'How do I clean my product?',
        type: 'answer',
        answer:
          "Most products: warm water and mild antibacterial soap (or a dedicated toy cleaner), before and after each use. Always check the product's specific instructions and avoid harsh chemicals.",
      },
      {
        id: 'storage',
        label: 'How should I store my products?',
        type: 'answer',
        answer:
          "Cool, dry place, out of direct sunlight. Keep silicone items separate (they can react with other materials). Avoid plastic bags, they trap moisture. Many products come with storage pouches.",
      },
      {
        id: 'lube',
        label: 'What lubricant should I use?',
        type: 'answer',
        answer:
          "**Water-based:** safe with everything.\n**Silicone-based:** longer lasting, but **don't use with silicone products**.\n**Oil-based:** never with latex.\n\nCheck the product page for specific recommendations.",
      },
      {
        id: 'replace',
        label: 'When should I replace a product?',
        type: 'answer',
        answer:
          "Replace at any sign of discoloration, odor, tackiness, tears, or cracks. Quality silicone can last years with proper care; other materials may need replacement sooner. When in doubt, replace for safety.",
      },
    ],
  },
  {
    id: 'something-else',
    label: 'Something else',
    type: 'escalate',
    transition: "OK, no problem. What's your question?",
  },
];

/** Walk a path of node IDs and return the child set at that depth. */
export function getChildrenAtPath(pathIds: string[]): TreeNode[] {
  let current: TreeNode[] = DECISION_TREE;
  for (const id of pathIds) {
    const next = current.find((n) => n.id === id);
    if (!next || next.type !== 'category') return [];
    current = next.children;
  }
  return current;
}

export function findNode(pathIds: string[], childId: string): TreeNode | undefined {
  return getChildrenAtPath(pathIds).find((n) => n.id === childId);
}
