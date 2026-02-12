import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrder } from '@/lib/woocommerce/orders';
import OrderDetails from '@/components/order/OrderDetails';

interface OrderConfirmationPageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ key?: string }>;
}

export default async function OrderConfirmationPage({ params, searchParams }: OrderConfirmationPageProps) {
  const { orderId } = await params;
  const { key } = await searchParams;

  // Order key is required to prevent unauthorized access to order details
  if (!key) {
    notFound();
  }

  // Fetch order from WooCommerce
  let order;
  try {
    order = await getOrder(parseInt(orderId, 10));
  } catch (error) {
    console.error('Error fetching order:', error);
    notFound();
  }

  if (!order) {
    notFound();
  }

  // Verify the order key matches to prevent information disclosure
  if (order.order_key !== key) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Success Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Order Confirmed!</h1>
        <p className="text-muted-foreground">
          Thank you for your order. We&apos;ve sent a confirmation email to{' '}
          <span className="font-medium text-foreground">{order.billing.email}</span>
        </p>
      </div>

      {/* Order Number */}
      <div className="bg-muted/30 rounded-lg p-4 text-center mb-8">
        <p className="text-sm text-muted-foreground">Order Number</p>
        <p className="text-2xl font-bold text-foreground">#{order.id}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {new Date(order.date_created).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Order Details */}
      <OrderDetails order={order} />

      {/* Actions */}
      <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
        <Link
          href="/shop"
          className="py-3 px-6 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold text-center"
        >
          Continue Shopping
        </Link>
        <Link
          href="/account/orders"
          className="py-3 px-6 border border-border text-foreground rounded-lg hover:bg-muted transition-colors font-semibold text-center"
        >
          View All Orders
        </Link>
      </div>

      {/* Support Info */}
      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          Questions about your order?{' '}
          <Link href="/contact" className="text-primary hover:text-primary-hover">
            Contact us
          </Link>
        </p>
      </div>
    </div>
  );
}
