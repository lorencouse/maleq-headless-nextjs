import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Male Q',
  description: 'Read the terms and conditions for using the Male Q website and services.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Terms of Service</h1>
          <p className="text-muted-foreground">Last updated: January 2026</p>
        </div>

        {/* Content */}
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-8">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Agreement to Terms</h2>
              <p className="text-muted-foreground">
                By accessing and using the Male Q website (&quot;Site&quot;), you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Age Requirement</h2>
              <p className="text-muted-foreground">
                You must be at least 18 years old to use this website and purchase products. By using this site and placing orders, you represent and warrant that you are at least 18 years of age. We reserve the right to refuse service to anyone who does not meet this age requirement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Account Registration</h2>
              <p className="text-muted-foreground">
                When you create an account, you must provide accurate and complete information. You are responsible for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activities that occur under your account</li>
                <li>Notifying us immediately of any unauthorized use</li>
                <li>Keeping your account information up to date</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                We reserve the right to terminate accounts that violate these terms or remain inactive for extended periods.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Products and Pricing</h2>
              <p className="text-muted-foreground">
                We strive to display accurate product information and pricing. However, we reserve the right to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Correct any errors or inaccuracies in product descriptions, images, or pricing</li>
                <li>Change prices without prior notice</li>
                <li>Limit order quantities</li>
                <li>Refuse or cancel any order, including orders with pricing errors</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                All prices are displayed in US dollars and do not include applicable taxes and shipping costs, which will be calculated at checkout.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Orders and Payment</h2>
              <p className="text-muted-foreground">
                By placing an order, you agree that:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>All information you provide is accurate and complete</li>
                <li>You are authorized to use the payment method provided</li>
                <li>You will pay all charges, including taxes and shipping fees</li>
                <li>We may verify your information before processing orders</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                We reserve the right to refuse or cancel orders for any reason, including suspected fraud or violation of these terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Shipping and Delivery</h2>
              <p className="text-muted-foreground">
                Shipping times are estimates and not guaranteed. We are not responsible for delays caused by carriers, customs, weather, or other factors beyond our control. Risk of loss passes to you upon delivery to the carrier.
              </p>
              <p className="text-muted-foreground mt-4">
                Please refer to our <a href="/shipping-returns" className="text-primary hover:underline">Shipping & Returns</a> page for detailed shipping information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Returns and Refunds</h2>
              <p className="text-muted-foreground">
                Our return and refund policy is detailed on our <a href="/shipping-returns" className="text-primary hover:underline">Shipping & Returns</a> page. By making a purchase, you agree to the terms of that policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Intellectual Property</h2>
              <p className="text-muted-foreground">
                All content on this website, including text, graphics, logos, images, and software, is the property of Male Q or its content suppliers and is protected by copyright and trademark laws.
              </p>
              <p className="text-muted-foreground mt-4">
                You may not reproduce, distribute, modify, or create derivative works from any content without our express written permission.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Prohibited Uses</h2>
              <p className="text-muted-foreground">You agree not to:</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Use the site for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to our systems</li>
                <li>Interfere with the proper functioning of the site</li>
                <li>Use automated systems to access the site without permission</li>
                <li>Impersonate another person or entity</li>
                <li>Engage in any fraudulent activity</li>
                <li>Resell products for commercial purposes without authorization</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Disclaimer of Warranties</h2>
              <p className="text-muted-foreground">
                THE SITE AND ALL PRODUCTS ARE PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
              <p className="text-muted-foreground mt-4">
                We do not warrant that the site will be uninterrupted, error-free, or free of viruses or other harmful components.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Limitation of Liability</h2>
              <p className="text-muted-foreground">
                TO THE FULLEST EXTENT PERMITTED BY LAW, MALEQ SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SITE OR PRODUCTS.
              </p>
              <p className="text-muted-foreground mt-4">
                Our total liability shall not exceed the amount you paid for the product giving rise to the claim.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Indemnification</h2>
              <p className="text-muted-foreground">
                You agree to indemnify and hold Male Q harmless from any claims, losses, or damages arising from your use of the site, violation of these terms, or infringement of any rights of another party.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Governing Law</h2>
              <p className="text-muted-foreground">
                These terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles. Any disputes shall be resolved in the courts of competent jurisdiction.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Changes to Terms</h2>
              <p className="text-muted-foreground">
                We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting. Your continued use of the site constitutes acceptance of the revised terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Contact Information</h2>
              <p className="text-muted-foreground">
                For questions about these Terms of Service, please contact us:
              </p>
              <ul className="list-none text-muted-foreground mt-2 space-y-1">
                <li>Contact form: <a href="/contact" className="text-primary hover:underline">Contact Us</a></li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
