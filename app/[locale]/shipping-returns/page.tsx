import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Shipping & Returns',
  description: 'Learn about Male Q shipping options, delivery times, discreet packaging, and our return and refund policy.',
  alternates: {
    canonical: '/shipping-returns',
  },
};

export default function ShippingReturnsPage() {
  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Shipping & Returns
          </h1>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about shipping, delivery, and our return policy
          </p>
        </div>

        {/* Shipping Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Shipping Information</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">Delivery Times</h3>
              <p className="text-muted-foreground mb-3">
                Shipping times vary depending on the shipping tier selected at checkout. Estimated delivery times are listed next to each shipping option and on your purchase receipt.
              </p>
              <p className="text-muted-foreground">
                All shipping times are quoted in <strong className="text-foreground">business days</strong> (excluding weekends and national holidays) and are based on typical delivery estimates from UPS and USPS. These are not delivery guarantees.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Order Tracking</h3>
              <p className="text-muted-foreground">
                We provide tracking information for all express shipping options. Please note that free and economy shipping may not include detailed tracking. You can check your order status by logging into your account.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Multiple Shipments</h3>
              <p className="text-muted-foreground">
                We ship from multiple warehouses across the United States. Depending on item availability and order size, your purchase may arrive in more than one shipment. If you haven&apos;t received all items by the end of the estimated delivery period, please contact us.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">International Shipping</h3>
              <p className="text-muted-foreground">
                We ship to many countries worldwide. International shipping options and estimated delivery times are available at checkout. For international orders, if your item hasn&apos;t arrived within the estimated shipping period, we will compensate the difference in price to the next applicable shipping tier.
              </p>
            </div>
          </div>
        </section>

        {/* Discreet Shipping Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Discreet Shipping & Billing</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">Plain Packaging</h3>
              <p className="text-muted-foreground">
                Your privacy is our top priority. All items are shipped in plain, unmarked packaging with no indication of the contents. The sender name will appear as <strong className="text-foreground">CNV</strong> or <strong className="text-foreground">TMQ</strong>. We never reveal the contents of your order on the outside of the package.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">International Customs</h3>
              <p className="text-muted-foreground">
                For international shipments and customs declarations, items are described as &quot;Health Equipment&quot;, &quot;Cosmetic&quot;, or &quot;Gift&quot;.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Billing Statement</h3>
              <p className="text-muted-foreground">
                All purchases appear as <strong className="text-foreground">TMQ LLC</strong> on your debit or credit card statement. We never reveal details of your purchase or the nature of the items.
              </p>
            </div>
          </div>
        </section>

        {/* Cancellations & Returns Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Cancellations & Returns</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">Order Cancellations</h3>
              <p className="text-muted-foreground">
                To deliver items as quickly as possible, orders are processed throughout the day as they are received. We can only cancel orders that have not yet shipped. We are unable to recall packages that have already been sent. Please contact us as soon as possible if you need to cancel an order.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Return Policy</h3>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-3">
                <p className="text-amber-800 dark:text-amber-200 font-medium">
                  For sanitary and hygienic purposes, all sales are final.
                </p>
              </div>
              <p className="text-muted-foreground">
                We provide refunds and replacements for <strong className="text-foreground">incorrectly sent</strong> or <strong className="text-foreground">damaged-on-arrival</strong> items only. Please inspect your items promptly upon delivery and contact us with any issues.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Bounced & Refused Packages</h3>
              <p className="text-muted-foreground">
                Bounced orders, undeliverable packages, or refused shipments are subject to a <strong className="text-foreground">10% restocking fee</strong>. Shipping fees on already-sent items are non-refundable.
              </p>
            </div>
          </div>
        </section>

        {/* Damaged/Defective Items */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Damaged or Defective Items</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8">
            <p className="text-muted-foreground mb-4">
              When you receive your package, promptly check all items to ensure they are in working order. We will credit or exchange defective items, as well as correct any shipping errors on our part.
            </p>
            <p className="text-muted-foreground mb-4">
              Please provide photos of the damage and keep all packaging materials. Contact us with details of the issue to receive a refund or replacement.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
            >
              Contact Customer Support
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </section>

        {/* Questions */}
        <div className="text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            Have more questions?
          </h2>
          <p className="text-muted-foreground mb-6">
            Check our FAQ or contact our customer support team.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/faq"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
            >
              View FAQ
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
