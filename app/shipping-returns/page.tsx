import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Shipping & Returns | Maleq',
  description: 'Learn about Maleq shipping options, delivery times, return policy, and refund process.',
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
            Everything you need to know about shipping and our return policy
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
              <h3 className="font-semibold text-foreground mb-3">Shipping Options</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-foreground">Method</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Delivery Time</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <td className="py-3 px-4">Standard Shipping</td>
                      <td className="py-3 px-4">5-7 business days</td>
                      <td className="py-3 px-4">$5.99 (Free over $100)</td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="py-3 px-4">Express Shipping</td>
                      <td className="py-3 px-4">2-3 business days</td>
                      <td className="py-3 px-4">$12.99</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4">Overnight Shipping</td>
                      <td className="py-3 px-4">1 business day</td>
                      <td className="py-3 px-4">$24.99</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Processing Time</h3>
              <p className="text-muted-foreground">
                Orders are processed within 1-2 business days. Orders placed after 2 PM EST or on weekends/holidays will be processed the next business day.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Shipping Locations</h3>
              <p className="text-muted-foreground">
                We currently ship to all 50 US states. Unfortunately, we do not ship to PO Boxes, APO/FPO addresses, or international destinations at this time.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Order Tracking</h3>
              <p className="text-muted-foreground">
                Once your order ships, you&apos;ll receive an email with tracking information. You can also track your order by logging into your account and viewing your order history.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Discreet Packaging</h3>
              <p className="text-muted-foreground">
                All orders are shipped in plain, unmarked packaging with no indication of the contents. The return address shows a generic company name for your privacy.
              </p>
            </div>
          </div>
        </section>

        {/* Returns Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Return Policy</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">30-Day Return Window</h3>
              <p className="text-muted-foreground">
                We accept returns within 30 days of delivery for most items. Products must be unused, unopened, and in their original packaging to qualify for a return.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Non-Returnable Items</h3>
              <p className="text-muted-foreground mb-2">
                For hygiene and safety reasons, the following items cannot be returned once opened:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Personal care and hygiene products</li>
                <li>Items marked as &quot;Final Sale&quot;</li>
                <li>Opened or used products</li>
                <li>Products without original packaging</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">How to Return an Item</h3>
              <ol className="list-decimal list-inside text-muted-foreground space-y-2">
                <li>Log into your account and go to Order History</li>
                <li>Select the order containing the item you wish to return</li>
                <li>Click &quot;Request Return&quot; and follow the prompts</li>
                <li>Print the return label and pack the item securely</li>
                <li>Drop off the package at the specified carrier location</li>
              </ol>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Return Shipping</h3>
              <p className="text-muted-foreground">
                For defective or incorrect items, we provide a prepaid return label at no cost. For other returns, the customer is responsible for return shipping costs.
              </p>
            </div>
          </div>
        </section>

        {/* Refunds Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Refunds</h2>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">Refund Timeline</h3>
              <p className="text-muted-foreground">
                Once we receive your return, please allow 3-5 business days for inspection. If approved, refunds are processed within 5-7 business days. Your bank may take additional time to post the refund to your account.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Refund Method</h3>
              <p className="text-muted-foreground">
                Refunds are issued to the original payment method used for the purchase. If you paid by credit card, the refund will appear on your card statement. If you used a digital wallet, the refund will be returned there.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">Partial Refunds</h3>
              <p className="text-muted-foreground">
                Items returned with signs of use, missing parts, or not in original condition may be subject to a partial refund or restocking fee of up to 25%.
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
              If you receive a damaged or defective item, please contact us within 48 hours of delivery. We&apos;ll work with you to resolve the issue quickly.
            </p>
            <p className="text-muted-foreground mb-4">
              Please provide photos of the damage and keep all packaging materials. We may offer a replacement, refund, or store credit depending on the situation and product availability.
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
