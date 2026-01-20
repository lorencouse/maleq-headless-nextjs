import { Metadata } from 'next';
import FaqAccordion from '@/components/faq/FaqAccordion';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions | Maleq',
  description: 'Find answers to common questions about orders, shipping, returns, and more at Maleq.',
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
        answer: 'Standard shipping typically takes 5-7 business days within the continental US. Express shipping (2-3 business days) and overnight options are available at checkout. Processing time is 1-2 business days before shipping.',
      },
      {
        question: 'Do you ship internationally?',
        answer: 'Currently, we only ship within the United States. We\'re working on expanding our shipping options to include international destinations in the future.',
      },
      {
        question: 'How can I track my order?',
        answer: 'Once your order ships, you\'ll receive an email with tracking information. You can also track your order by logging into your account and viewing your order history.',
      },
      {
        question: 'What shipping carriers do you use?',
        answer: 'We primarily use USPS, UPS, and FedEx depending on the shipping method selected and package size. The specific carrier will be noted in your shipping confirmation email.',
      },
      {
        question: 'Is my order discreet?',
        answer: 'Yes, all orders are shipped in plain, unmarked packaging with no indication of the contents. Your billing statement will show a generic company name.',
      },
    ],
  },
  {
    title: 'Returns & Refunds',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
      </svg>
    ),
    items: [
      {
        question: 'What is your return policy?',
        answer: 'We accept returns within 30 days of delivery for unused, unopened items in original packaging. Some items may be final sale and not eligible for return. Please check the product page for specific return eligibility.',
      },
      {
        question: 'How do I initiate a return?',
        answer: 'To start a return, log into your account, go to your order history, and select the order you wish to return. Follow the prompts to generate a return label. Alternatively, contact our customer service team for assistance.',
      },
      {
        question: 'When will I receive my refund?',
        answer: 'Once we receive and inspect your return, refunds are processed within 5-7 business days. The refund will be credited to your original payment method. Please allow additional time for your bank to process the refund.',
      },
      {
        question: 'Do I have to pay for return shipping?',
        answer: 'For defective or incorrect items, we provide a prepaid return label. For other returns, the customer is responsible for return shipping costs. A restocking fee may apply for some items.',
      },
    ],
  },
  {
    title: 'Payment & Security',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    items: [
      {
        question: 'What payment methods do you accept?',
        answer: 'We accept all major credit cards (Visa, MasterCard, American Express, Discover), as well as digital wallets like Apple Pay and Google Pay through our secure checkout.',
      },
      {
        question: 'Is my payment information secure?',
        answer: 'Yes, we use industry-standard SSL encryption and our payment processing is handled by Stripe, a PCI-compliant payment processor. We never store your full credit card information on our servers.',
      },
      {
        question: 'Do you offer payment plans?',
        answer: 'For qualifying orders, you may have the option to use services like Afterpay or Klarna to split your purchase into installments. These options will appear at checkout if available.',
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
        answer: 'You can checkout as a guest, but creating an account allows you to track orders, save addresses, create wishlists, and access exclusive member benefits.',
      },
      {
        question: 'How do I reset my password?',
        answer: 'Click "Forgot Password" on the login page and enter your email address. We\'ll send you a link to reset your password. Check your spam folder if you don\'t see the email.',
      },
      {
        question: 'Can I modify or cancel my order?',
        answer: 'Orders can be modified or cancelled within 1 hour of placement. After that, the order enters processing and cannot be changed. Please contact us immediately if you need to make changes.',
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
        answer: 'You can sign up for stock alerts on any product page. We\'ll email you as soon as the item is back in stock. Popular items typically restock within 2-4 weeks.',
      },
      {
        question: 'Do you price match?',
        answer: 'We strive to offer competitive prices. If you find a lower price from an authorized retailer, contact us with the details and we\'ll do our best to match or beat it.',
      },
      {
        question: 'How do I know what size to order?',
        answer: 'Check the product description for detailed specifications including dimensions. If you have questions about sizing, don\'t hesitate to contact our customer service team for guidance.',
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
            Find answers to common questions about shopping with Maleq
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
              category.items.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: item.answer,
                },
              }))
            ),
          }),
        }}
      />
    </div>
  );
}
