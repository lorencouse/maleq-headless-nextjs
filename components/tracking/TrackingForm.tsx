'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { trackOrderSchema, type TrackOrderInput } from '@/lib/validations/tracking';

interface TrackingItem {
  tracking_provider: string;
  tracking_number: string;
  tracking_link: string;
  date_shipped: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  total: string;
  image: string | null;
}

interface OrderData {
  number: string;
  status: string;
  status_label: string;
  date_created: string;
  total: string;
  currency: string;
  items: OrderItem[];
  shipping_method: string;
  tracking: TrackingItem[];
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'on-hold': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  shipped: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

export default function TrackingForm() {
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TrackOrderInput>({
    resolver: zodResolver(trackOrderSchema),
  });

  const onSubmit = async (data: TrackOrderInput) => {
    setIsLoading(true);
    setError(null);
    setOrder(null);

    try {
      const response = await fetch('/api/track-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'No order found. Please check your details.');
        return;
      }

      setOrder(result.data);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: string, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(parseFloat(amount));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div>
      {/* Lookup Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="bg-card border border-border rounded-xl p-6 md:p-8">
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="orderNumber" className="block text-sm font-medium text-foreground mb-2">
              Order Number
            </label>
            <input
              id="orderNumber"
              type="text"
              placeholder="e.g. 12345"
              className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              {...register('orderNumber')}
            />
            {errors.orderNumber && (
              <p className="mt-1 text-sm text-red-500">{errors.orderNumber.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
              Billing Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="email@example.com"
              className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="mt-6 w-full sm:w-auto px-8 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Looking up order...
            </span>
          ) : (
            'Track Order'
          )}
        </button>
      </form>

      {/* Error Message */}
      {error && (
        <div className="mt-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Order Results */}
      {order && (
        <div className="mt-8 space-y-6">
          {/* Order Summary */}
          <div className="bg-card border border-border rounded-xl p-6 md:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Order #{order.number}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Placed on {formatDate(order.date_created)}
                </p>
              </div>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                {order.status_label}
              </span>
            </div>

            {/* Items */}
            <div className="border-t border-border pt-6">
              <h3 className="font-semibold text-foreground mb-4">Items</h3>
              <div className="space-y-3">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground truncate">{item.name}</p>
                      <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                    </div>
                    <p className="text-foreground font-medium ml-4">
                      {formatCurrency(item.total, order.currency)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <p className="font-semibold text-foreground">Total</p>
                <p className="font-semibold text-foreground">
                  {formatCurrency(order.total, order.currency)}
                </p>
              </div>
            </div>

            {/* Shipping Method */}
            {order.shipping_method && (
              <div className="border-t border-border pt-6 mt-6">
                <h3 className="font-semibold text-foreground mb-2">Shipping Method</h3>
                <p className="text-muted-foreground">{order.shipping_method}</p>
              </div>
            )}
          </div>

          {/* Tracking Information */}
          {order.tracking.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Shipment Tracking</h3>
              </div>
              <div className="space-y-4">
                {order.tracking.map((shipment, i) => (
                  <div key={i} className="bg-input/30 border border-border rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        {shipment.tracking_provider && (
                          <p className="font-medium text-foreground">{shipment.tracking_provider}</p>
                        )}
                        <p className="text-sm text-muted-foreground font-mono mt-1">
                          {shipment.tracking_number}
                        </p>
                        {shipment.date_shipped && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Shipped: {formatDate(shipment.date_shipped)}
                          </p>
                        )}
                      </div>
                      {shipment.tracking_link && (
                        <a
                          href={shipment.tracking_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
                        >
                          Track Package
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No tracking yet */}
          {order.tracking.length === 0 && (order.status === 'processing' || order.status === 'pending' || order.status === 'on-hold') && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-blue-800 dark:text-blue-200">
                  Your order is being prepared. Tracking information will be available once your order ships.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
