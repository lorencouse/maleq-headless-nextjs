'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';
import { ButtonLink } from '@/components/ui/Button';

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

function formatPrice(price: string | number, locale: string): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

import { getStatusColor } from '@/lib/constants/status-colors';

export default function OrdersPage() {
  const t = useTranslations('account.orders');
  const tStatus = useTranslations('account.orders.status');
  const locale = useLocale();
  const { user, token } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Locale-aware date formatting; e.g. "May 27, 2026" (en) vs "27 de mayo de 2026" (es)
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  useEffect(() => {
    async function fetchOrders() {
      if (!user?.id) return;

      try {
        const params = new URLSearchParams({ customerId: String(user.id) });
        if (user.email) params.set('email', user.email);
        const response = await fetch(`/api/orders?${params}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(t('failedToFetch'));
        }

        const data = await response.json();
        setOrders(data.orders || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('failedToLoad'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchOrders();
  }, [user?.id, user?.email, token, t]);

  return (
    <AccountLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-foreground">{t('heading')}</h1>
        </div>

        {isLoading ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">{t('loading')}</p>
          </div>
        ) : error ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <p className="text-destructive">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-muted-foreground"
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
            <h3 className="text-lg font-semibold text-foreground mb-2">{t('noOrdersHeading')}</h3>
            <p className="text-muted-foreground mb-6">
              {t('noOrdersHint')}
            </p>
            <ButtonLink href="/shop" size="md">
              {t('browseProducts')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </ButtonLink>
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
                        {t('colOrderNumber')}
                      </p>
                      <p className="font-semibold text-foreground">#{order.number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('colDate')}</p>
                      <p className="font-medium text-foreground">{formatDate(order.date_created)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('colTotal')}</p>
                      <p className="font-semibold text-foreground">{formatPrice(order.total, locale)}</p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                      order.status
                    )}`}
                  >
                    {tStatus.has(order.status) ? tStatus(order.status) : order.status}
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
                        <span className="text-foreground">{formatPrice(item.total, locale)}</span>
                      </div>
                    ))}
                    {order.line_items.length > 3 && (
                      <p className="text-sm text-muted-foreground">
                        {t('moreItems', { count: order.line_items.length - 3 })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Order Actions */}
                <div className="px-4 py-3 border-t border-border flex justify-end gap-3">
                  <Link
                    href={`/account/orders/${order.id}`}
                    className="px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors cursor-pointer"
                  >
                    {t('viewDetailsAndTrack')}
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
