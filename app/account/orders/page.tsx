'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  total: string;
}

interface Order {
  id: number;
  number: string;
  status: string;
  date_created: string;
  total: string;
  line_items: OrderItem[];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
    case 'processing':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
    case 'on-hold':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
    case 'pending':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
    case 'cancelled':
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
    case 'refunded':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
  }
}

function formatStatus(status: string): string {
  return status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function OrdersPage() {
  const { user, token } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrders() {
      if (!user?.id) return;

      try {
        const response = await fetch(`/api/orders?customerId=${user.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch orders');
        }

        const data = await response.json();
        setOrders(data.orders || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      } finally {
        setIsLoading(false);
      }
    }

    fetchOrders();
  }, [user?.id, token]);

  return (
    <AccountLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-foreground">Order History</h1>
        </div>

        {isLoading ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading orders...</p>
          </div>
        ) : error ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <p className="text-red-500">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            <h3 className="text-lg font-semibold text-foreground mb-2">No orders yet</h3>
            <p className="text-muted-foreground mb-6">
              You haven&apos;t placed any orders. Start shopping to see your order history here.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold"
            >
              Browse Products
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-card border border-border rounded-xl overflow-hidden"
              >
                {/* Order Header */}
                <div className="p-4 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Order Number
                      </p>
                      <p className="font-semibold text-foreground">#{order.number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Date</p>
                      <p className="font-medium text-foreground">{formatDate(order.date_created)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
                      <p className="font-semibold text-foreground">{formatPrice(order.total)}</p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                      order.status
                    )}`}
                  >
                    {formatStatus(order.status)}
                  </span>
                </div>

                {/* Order Items */}
                <div className="p-4">
                  <div className="space-y-3">
                    {order.line_items.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {item.quantity} &times;
                          </span>
                          <span className="text-foreground">{item.name}</span>
                        </div>
                        <span className="text-foreground">{formatPrice(item.total)}</span>
                      </div>
                    ))}
                    {order.line_items.length > 3 && (
                      <p className="text-sm text-muted-foreground">
                        +{order.line_items.length - 3} more item
                        {order.line_items.length - 3 > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>

                {/* Order Actions */}
                <div className="px-4 py-3 border-t border-border flex justify-end gap-3">
                  <Link
                    href={`/order-confirmation/${order.id}`}
                    className="px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
