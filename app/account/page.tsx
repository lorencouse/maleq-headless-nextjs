'use client';

import Link from 'next/link';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

export default function AccountDashboard() {
  const { user } = useAuthStore();

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
              className="bg-card border border-border rounded-xl p-6 hover:border-primary hover:shadow-md transition-all group"
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
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
