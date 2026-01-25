'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

interface OrderLineItem {
  name: string;
  quantity: number;
}

interface Order {
  id: number;
  number: string;
  status: string;
  total: string;
  date_created: string;
  line_items: OrderLineItem[];
}

const statusColors: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'on-hold': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  pending: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
};

export default function AccountDashboard() {
  const { user, token } = useAuthStore();
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchRecentOrders() {
      if (!user?.id || !token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/orders?customerId=${user.id}&per_page=3`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setRecentOrders(data.orders || []);
        }
      } catch (err) {
        console.error('Error fetching orders:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchRecentOrders();
  }, [user?.id, token]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const quickLinks = [
    {
      title: 'Orders',
      description: 'View and track your orders',
      href: '/account/orders',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
    },
    {
      title: 'Addresses',
      description: 'Manage shipping and billing addresses',
      href: '/account/addresses',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      title: 'Account Details',
      description: 'Update your profile and password',
      href: '/account/details',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <AccountLayout>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Welcome back, {user?.firstName || 'there'}!
          </h1>
          <p className="text-muted-foreground">
            From your account dashboard you can view your recent orders, manage your shipping and
            billing addresses, and edit your account details.
          </p>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-card border border-border rounded-xl p-6 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="text-primary mb-4 group-hover:scale-110 transition-transform">
                {link.icon}
              </div>
              <h3 className="font-semibold text-foreground mb-1">{link.title}</h3>
              <p className="text-sm text-muted-foreground">{link.description}</p>
            </Link>
          ))}
        </div>

        {/* Recent Orders Preview */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border flex justify-between items-center">
            <h2 className="text-lg font-semibold text-foreground">Recent Orders</h2>
            <Link
              href="/account/orders"
              className="text-sm text-primary hover:text-primary-hover font-medium"
            >
              View all orders
            </Link>
          </div>
          <div className="p-6">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
              </div>
            ) : recentOrders.length > 0 ? (
              <div className="space-y-4">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-4 border border-border rounded-lg hover:border-primary/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-semibold text-foreground">
                          Order #{order.number}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                            statusColors[order.status] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {order.status.replace('-', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(order.date_created)} &middot; {order.line_items.length} item
                        {order.line_items.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{order.total}</p>
                      <Link
                        href={`/account/orders/${order.id}`}
                        className="text-sm text-primary hover:text-primary-hover"
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <svg
                  className="w-12 h-12 mx-auto mb-4 text-muted-foreground"
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
                <p className="mb-4">You haven&apos;t placed any orders yet.</p>
                <Link
                  href="/products"
                  className="inline-flex items-center gap-2 text-primary hover:text-primary-hover font-medium"
                >
                  Start shopping
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
            )}
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
