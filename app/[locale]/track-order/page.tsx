import { Metadata } from 'next';
import Link from 'next/link';
import TrackingForm from '@/components/tracking/TrackingForm';

export const metadata: Metadata = {
  title: 'Track Your Order',
  description: 'Track your Male Q order status and shipping information. Enter your order number and billing email to get real-time updates.',
  alternates: {
    canonical: '/track-order',
  },
  robots: { index: false },
};

export default function TrackOrderPage() {
  return (
    <div className="min-h-screen py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Track Your Order
          </h1>
          <p className="text-lg text-muted-foreground">
            Enter your order number and billing email to check your order status and shipping details.
          </p>
        </div>

        <TrackingForm />

        {/* Help Section */}
        <div className="mt-12 text-center bg-muted/30 rounded-xl p-8 border border-border">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            Need help with your order?
          </h2>
          <p className="text-muted-foreground mb-6">
            If you have an account, you can also view your orders there. Otherwise, contact our support team.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/account/orders"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
            >
              View Account Orders
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
