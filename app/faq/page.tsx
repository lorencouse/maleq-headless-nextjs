import { Metadata } from 'next';
import Image from 'next/image';
import FaqAccordion from '@/components/faq/FaqAccordion';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description: 'Find answers to common questions about orders, shipping, returns, and more at Male Q.',
  alternates: {
    canonical: '/faq',
  },
};

const faqCategories = [
  {
    title: 'Orders & Shipping',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
    items: [
      {
        question: 'How long does shipping take?',
        answer: 'Shipping times vary depending on the shipping tier selected at checkout. Estimated delivery times are listed next to each shipping option and on your purchase receipt. All shipping times are quoted in business days (excluding weekends and holidays) and are based on typical delivery estimates from UPS and USPS. If your order hasn\'t arrived within the estimated window, please contact us.',
      },
      {
        question: 'Will I receive a tracking number?',
        answer: 'We provide tracking information for all express shipping options. Please note that free and economy shipping may not include detailed tracking. You can check your order status by logging into your account.',
      },
      {
        question: 'Why did my order arrive in multiple packages?',
        answer: 'We ship from multiple warehouses across the US. Depending on item availability and order size, your purchase may arrive in more than one shipment. If you haven\'t received all items by the end of the estimated delivery period, please contact us.',
      },
      {
        question: 'Do you ship internationally?',
        answer: 'Yes, we ship to many countries worldwide. International shipping options and estimated delivery times are available at checkout. For international orders, if your item hasn\'t arrived within the estimated shipping period, we\'ll compensate the difference in price to the next applicable shipping tier.',
      },
      {
        question: 'What shipping carriers do you use?',
        answer: 'We primarily use USPS and UPS depending on the shipping method selected and package size. The specific carrier will be noted in your shipping confirmation email.',
      },
    ],
  },
  {
    title: 'Privacy & Discreet Shipping',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    items: [
      {
        question: 'Is your shipping discreet?',
        answer: (
          <div>
            <p>Your privacy is our top priority. All items are shipped in plain, unmarked packaging with no indication of the contents. The sender name will appear as CNV or TMQ. For international shipments and customs, items are declared as &quot;Health Equipment&quot;, &quot;Cosmetic&quot;, or &quot;Gift&quot;.</p>
            <Image
              src="/images/discreet-shipping.jpg"
              alt="Example of our plain, discreet shipping packaging"
              width={500}
              height={300}
              className="mt-4 rounded-lg border border-border"
            />
          </div>
        ),
        answerText: 'Your privacy is our top priority. All items are shipped in plain, unmarked packaging with no indication of the contents. The sender name will appear as CNV or TMQ. For international shipments and customs, items are declared as "Health Equipment", "Cosmetic", or "Gift".',
      },
      {
        question: 'What name appears on my billing statement?',
        answer: 'All purchases appear as "TMQ LLC" on your debit or credit card statement. We never reveal details of your purchase or the nature of the items on your statement.',
      },
    ],
  },
  {
    title: 'Cancellations & Returns',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
      </svg>
    ),
    items: [
      {
        question: 'Can I cancel my order?',
        answer: 'To deliver items as quickly as possible, orders are processed throughout the day as they are received. We can only cancel orders that have not yet shipped. We are unable to recall packages that have already been sent. Please contact us as soon as possible if you need to cancel.',
      },
      {
        question: 'What is your return policy?',
        answer: 'For sanitary and hygienic purposes, all sales are final. We provide refunds and replacements for incorrectly sent or damaged-on-arrival items only. Please inspect your items promptly upon delivery.',
      },
      {
        question: 'What about bounced or refused packages?',
        answer: 'Bounced orders, undeliverable packages, or refused shipments are subject to a 10% restocking fee. Please note that shipping fees on already-sent items are non-refundable.',
      },
      {
        question: 'My item arrived broken or defective. What do I do?',
        answer: 'When you receive your package, promptly check all items to ensure they are in working order. We will credit or exchange defective items, as well as correct any shipping errors on our part. Please contact us with details of the issue to receive a refund or replacement.',
      },
    ],
  },
  {
    title: 'Payment & Billing',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    items: [
      {
        question: 'What payment methods do you accept?',
        answer: 'We accept all major credit cards (Visa, MasterCard, American Express, Discover) as well as Apple Pay and Google Pay through our secure Stripe-powered checkout.',
      },
      {
        question: 'Do you accept international currencies?',
        answer: 'Yes, we accept most world currencies. All items are listed in US Dollars and can be charged in your local currency. At checkout, you will be billed according to the exchange rate set by your bank or credit card company, which may include additional fees. Contact your bank for details about international transaction fees.',
      },
      {
        question: 'Is my payment information secure?',
        answer: 'Yes, we use industry-standard SSL encryption and our payment processing is handled by Stripe, a PCI-compliant payment processor. We never store your full credit card information on our servers.',
      },
      {
        question: 'Do you offer payment plans?',
        answer: 'Yes! We offer Afterpay and Klarna at checkout, allowing you to split your purchase into interest-free installments. These options will appear automatically during checkout for qualifying orders.',
      },
      {
        question: 'Why was my payment declined?',
        answer: 'Payments can be declined for various reasons including incorrect card information, insufficient funds, or your bank\'s fraud protection. Please verify your information and try again, or contact your bank for assistance.',
      },
    ],
  },
  {
    title: 'Account & Orders',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    items: [
      {
        question: 'Do I need an account to place an order?',
        answer: 'You can checkout as a guest, but creating an account allows you to track orders, save addresses, create wishlists, and view your order history.',
      },
      {
        question: 'How do I reset my password?',
        answer: 'Click "Forgot Password" on the login page and enter your email address. We\'ll send you a link to reset your password. Check your spam folder if you don\'t see the email within a few minutes.',
      },
      {
        question: 'How do I use a coupon code?',
        answer: 'Enter your coupon code in the designated field on the cart page or during checkout. Click "Apply" and the discount will be reflected in your order total. Only one coupon can be used per order.',
      },
    ],
  },
  {
    title: 'Products',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    items: [
      {
        question: 'Are your products authentic?',
        answer: 'Yes, we only sell 100% authentic products sourced directly from authorized distributors and manufacturers. We guarantee the authenticity of every item we sell.',
      },
      {
        question: 'What if an item is out of stock?',
        answer: 'You can sign up for stock alerts on any product page. We\'ll email you as soon as the item is back in stock.',
      },
      {
        question: 'How do I know what size to order?',
        answer: 'Check the product description for detailed specifications including dimensions and weight. If you have questions about sizing, don\'t hesitate to contact our customer service team for guidance.',
      },
    ],
  },
  {
    title: 'Product Care',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
    items: [
      {
        question: 'How should I clean my products?',
        answer: 'Most products should be cleaned before and after each use with warm water and mild antibacterial soap, or a specialized toy cleaner. Always check the product instructions for specific care guidelines. Avoid harsh chemicals that could damage the material.',
      },
      {
        question: 'How should I store my products?',
        answer: 'Store products in a cool, dry place away from direct sunlight. Many items come with storage pouches or cases. Keep silicone items separate from other materials to prevent chemical reactions. Avoid storing in plastic bags which can trap moisture.',
      },
      {
        question: 'What type of lubricant should I use?',
        answer: 'Water-based lubricants are safe with all materials. Silicone-based lubes provide longer-lasting lubrication but should NOT be used with silicone products. Oil-based lubricants should not be used with latex products. Check the product page for specific recommendations.',
      },
      {
        question: 'How do I know when to replace a product?',
        answer: 'Replace products if you notice any discoloration, unusual odor, tackiness, tears, or cracks. High-quality silicone products can last years with proper care, while other materials may need replacement sooner. When in doubt, replace for safety.',
      },
    ],
  },
  {
    title: 'Health & Safety',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    items: [
      {
        question: 'Is there a health and safety disclaimer?',
        answer: 'Please carefully review all health and safety information provided by the manufacturer of each product. As a retailer, we are not responsible for injury or medical complications resulting from the purchase or use of these products. For important health and safety information, please contact the product manufacturer directly.',
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-lg text-muted-foreground">
            Find answers to common questions about shopping with Male Q
          </p>
        </div>

        {/* FAQ Categories */}
        <div className="space-y-12">
          {faqCategories.map((category, categoryIndex) => (
            <section key={categoryIndex}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  {category.icon}
                </div>
                <h2 className="text-2xl font-semibold text-foreground">
                  {category.title}
                </h2>
              </div>
              <FaqAccordion items={category.items} />
            </section>
          ))}
        </div>

        {/* Still Have Questions */}
        <div className="mt-16 text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            Still have questions?
          </h2>
          <p className="text-muted-foreground mb-6">
            Can&apos;t find the answer you&apos;re looking for? Our customer support team is here to help.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
          >
            Contact Support
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Structured Data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqCategories.flatMap((category) =>
              category.items
                .filter((item) => typeof item.answer === 'string' || 'answerText' in item)
                .map((item) => ({
                  '@type': 'Question',
                  name: item.question,
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: ('answerText' in item ? item.answerText : item.answer) as string,
                  },
                }))
            ),
          }),
        }}
      />
    </div>
  );
}
