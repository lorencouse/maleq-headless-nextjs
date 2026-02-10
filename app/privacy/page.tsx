import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Male Q',
  description: 'Learn how Male Q collects, uses, and protects your personal information.',
  alternates: {
    canonical: '/privacy',
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: January 2026</p>
        </div>

        {/* Content */}
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-8">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Introduction</h2>
              <p className="text-muted-foreground">
                Male Q (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and make purchases through our online store.
              </p>
              <p className="text-muted-foreground mt-4">
                Please read this policy carefully. If you do not agree with the terms of this privacy policy, please do not access the site.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Information We Collect</h2>

              <h3 className="text-lg font-medium text-foreground mt-6 mb-3">Personal Information</h3>
              <p className="text-muted-foreground">
                We may collect personal information that you voluntarily provide when you:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Create an account</li>
                <li>Make a purchase</li>
                <li>Subscribe to our newsletter</li>
                <li>Contact customer support</li>
                <li>Participate in surveys or promotions</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                This information may include your name, email address, shipping address, billing address, phone number, and payment information.
              </p>

              <h3 className="text-lg font-medium text-foreground mt-6 mb-3">Automatically Collected Information</h3>
              <p className="text-muted-foreground">
                When you access our website, we automatically collect certain information, including:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Device information (browser type, operating system)</li>
                <li>IP address</li>
                <li>Pages visited and time spent</li>
                <li>Referring website</li>
                <li>Location data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">How We Use Your Information</h2>
              <p className="text-muted-foreground">We use the information we collect to:</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Process and fulfill your orders</li>
                <li>Send order confirmations and shipping updates</li>
                <li>Respond to customer service requests</li>
                <li>Send marketing communications (with your consent)</li>
                <li>Improve our website and services</li>
                <li>Prevent fraud and enhance security</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Information Sharing</h2>
              <p className="text-muted-foreground">
                We do not sell, trade, or rent your personal information to third parties. We may share your information with:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li><strong>Service Providers:</strong> Companies that help us operate our business (payment processors, shipping carriers, email services)</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Cookies and Tracking</h2>
              <p className="text-muted-foreground">
                We use cookies and similar tracking technologies to enhance your browsing experience. Cookies help us:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Remember your preferences and cart items</li>
                <li>Analyze website traffic and usage</li>
                <li>Deliver targeted advertisements</li>
                <li>Improve website performance</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                You can control cookies through your browser settings. However, disabling cookies may limit your ability to use certain features of our website.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Data Security</h2>
              <p className="text-muted-foreground">
                We implement industry-standard security measures to protect your personal information, including:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>SSL encryption for all data transmissions</li>
                <li>PCI-compliant payment processing</li>
                <li>Regular security assessments</li>
                <li>Limited access to personal information</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                While we strive to protect your information, no method of transmission over the Internet is 100% secure. We cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Your Rights</h2>
              <p className="text-muted-foreground">You have the right to:</p>
              <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
                <li>Access the personal information we hold about you</li>
                <li>Request correction of inaccurate information</li>
                <li>Request deletion of your information</li>
                <li>Opt-out of marketing communications</li>
                <li>Withdraw consent for data processing</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                To exercise these rights, please <a href="/contact" className="text-primary hover:underline">contact us</a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Children&apos;s Privacy</h2>
              <p className="text-muted-foreground">
                Our website is not intended for children under 18 years of age. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Changes to This Policy</h2>
              <p className="text-muted-foreground">
                We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date. We encourage you to review this policy periodically.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">Contact Us</h2>
              <p className="text-muted-foreground">
                If you have questions about this Privacy Policy, please contact us:
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
