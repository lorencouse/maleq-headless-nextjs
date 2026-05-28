'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
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

import { statusColors } from '@/lib/constants/status-colors';

export default function AccountDashboard() {
  const t = useTranslations('account.dashboard');
  const tNav = useTranslations('account.nav');
  const tStatus = useTranslations('account.orders.status');
  const locale = useLocale();
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

  // Locale-aware date formatting: en-US → "May 27, 2026", es → "27 may 2026"
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Labels reuse the account.nav keys so they match the sidebar exactly.
  const quickLinks = [
    {
      titleKey: 'orders' as const,
      descriptionKey: 'ordersDescription' as const,
      href: '/account/orders',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
    },
    {
      titleKey: 'addresses' as const,
      descriptionKey: 'addressesDescription' as const,
      href: '/account/addresses',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      titleKey: 'accountDetails' as const,
      descriptionKey: 'accountDetailsDescription' as const,
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
            {user?.firstName
              ? t('welcomeBack', { name: user.firstName })
              : t('welcomeBackAnonymous')}
          </h1>
          <p className="text-muted-foreground">
            {t('intro')}
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
              <h3 className="font-semibold text-foreground mb-1">{tNav(link.titleKey)}</h3>
              <p className="text-sm text-muted-foreground">{t(link.descriptionKey)}</p>
            </Link>
          ))}
        </div>

        {/* Recent Orders Preview */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border flex justify-between items-center">
            <h2 className="text-lg font-semibold text-foreground">{t('recentOrders')}</h2>
            <Link
              href="/account/orders"
              className="text-sm text-primary hover:text-primary-hover font-medium"
            >
              {t('viewAllOrders')}
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
                          {t('orderNumber', { number: order.number })}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                            statusColors[order.status] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {tStatus.has(order.status) ? tStatus(order.status) : order.status.replace('-', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(order.date_created)} &middot; {t('itemCount', { count: order.line_items.length })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{order.total}</p>
                      <Link
                        href={`/account/orders/${order.id}`}
                        className="text-sm text-primary hover:text-primary-hover"
                      >
                        {t('viewDetails')}
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
                <p className="mb-4">{t('noOrdersYet')}</p>
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-2 text-primary hover:text-primary-hover font-medium"
                >
                  {t('startShopping')}
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
