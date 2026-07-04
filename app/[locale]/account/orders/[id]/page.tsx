'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';
import { buttonClasses } from '@/components/ui/Button';

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  total: string;
  price: number;
  sku: string;
  image?: {
    src: string;
  };
}

interface Address {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

interface Tracking {
  tracking_number?: string;
  tracking_provider?: string;
  tracking_link?: string;
  date_shipped?: string;
}

interface WarehouseTrackingSummary {
  fulfillmentStatus?: string | null;
  strategy?: string | null;
}

interface Order {
  id: number;
  number: string;
  status: string;
  date_created: string;
  date_modified: string;
  date_completed?: string;
  date_paid?: string;
  total: string;
  subtotal: string;
  total_tax: string;
  shipping_total: string;
  discount_total: string;
  payment_method_title: string;
  line_items: OrderItem[];
  billing: Address;
  shipping: Address;
  tracking?: Tracking;
  tracking_shipments?: Tracking[];
  warehouse_tracking?: WarehouseTrackingSummary;
  customer_note?: string;
}

// Timeline step keys map to account.orderDetail.timeline.* translations.
const ORDER_STATUSES = [
  { key: 'pending', labelKey: 'orderPlaced' as const, icon: 'clipboard' },
  { key: 'processing', labelKey: 'processing' as const, icon: 'cog' },
  { key: 'shipped', labelKey: 'shipped' as const, icon: 'truck' },
  { key: 'completed', labelKey: 'delivered' as const, icon: 'check' },
];

function getStatusIndex(status: string): number {
  if (status === 'completed') return 4;
  if (status === 'shipped') return 3;
  if (status === 'processing') return 2;
  return 1;
}

function getTrackingUrl(provider: string | undefined, trackingNumber: string): string {
  const normalizedProvider = provider?.toLowerCase() || '';

  if (normalizedProvider.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  }
  if (normalizedProvider.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  }
  if (normalizedProvider.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  }
  if (normalizedProvider.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  }
  // Default to Google search
  return `https://www.google.com/search?q=${trackingNumber}+tracking`;
}

import { getStatusColor } from '@/lib/constants/status-colors';

export default function OrderDetailPage() {
  const t = useTranslations('account.orderDetail');
  const tTimeline = useTranslations('account.orderDetail.timeline');
  const tStatus = useTranslations('account.orders.status');
  const locale = useLocale();
  const params = useParams();
  const { user, token } = useAuthStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Locale-aware formatters (previously hardcoded en-US).
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: string | number): string => {
    const num = typeof price === 'string' ? parseFloat(price) : price;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

  useEffect(() => {
    async function fetchOrder() {
      if (!user?.id || !params.id) return;

      try {
        const response = await fetch(`/api/orders/${params.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(t('errorNotFound'));
          }
          throw new Error(t('errorFetch'));
        }

        const data = await response.json();
        setOrder(data.order);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorLoad'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchOrder();
  }, [user?.id, token, params.id, t]);

  const currentStatusIndex = order ? getStatusIndex(order.status) : 0;
  const trackingShipments = order
    ? order.tracking_shipments && order.tracking_shipments.length > 0
      ? order.tracking_shipments
      : order.tracking?.tracking_number
        ? [order.tracking]
        : []
    : [];

  return (
    <AccountLayout>
      <div className="space-y-6">
        {/* Back Link */}
        <Link
          href="/account/orders"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('backToOrders')}
        </Link>

        {isLoading ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">{t('loading')}</p>
          </div>
        ) : error ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Link href="/account/orders" className="text-primary hover:text-primary-hover font-medium">
              {t('returnToOrders')}
            </Link>
          </div>
        ) : order ? (
          <>
            {/* Order Header */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-foreground mb-1">
                    {t('headingNumber', { number: order.number })}
                  </h1>
                  <p className="text-muted-foreground">
                    {t('placedOn', { date: formatDateTime(order.date_created) })}
                  </p>
                </div>
                <span className={`px-4 py-2 rounded-full text-sm font-semibold ${getStatusColor(order.status)}`}>
                  {tStatus.has(order.status) ? tStatus(order.status) : order.status}
                </span>
              </div>
            </div>

            {/* Order Status Timeline */}
            {!['cancelled', 'failed', 'refunded'].includes(order.status) && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="heading-plain text-lg font-semibold text-foreground mb-6">{t('statusTimeline')}</h2>
                <div className="relative">
                  {/* Progress Line */}
                  <div className="absolute top-5 left-5 right-5 h-0.5 bg-border">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${((currentStatusIndex - 1) / (ORDER_STATUSES.length - 1)) * 100}%` }}
                    />
                  </div>

                  {/* Status Steps */}
                  <div className="relative flex justify-between">
                    {ORDER_STATUSES.map((status, index) => {
                      const isCompleted = index + 1 <= currentStatusIndex;
                      const isCurrent = index + 1 === currentStatusIndex;

                      return (
                        <div key={status.key} className="flex flex-col items-center">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center z-10 transition-colors ${
                              isCompleted
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground'
                            } ${isCurrent ? 'ring-4 ring-primary/30' : ''}`}
                          >
                            {status.icon === 'clipboard' && (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                            )}
                            {status.icon === 'cog' && (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            )}
                            {status.icon === 'truck' && (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                              </svg>
                            )}
                            {status.icon === 'check' && (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className={`mt-2 text-xs font-medium text-center ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {tTimeline(status.labelKey)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Tracking Information */}
            {trackingShipments.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="heading-plain text-lg font-semibold text-foreground mb-4">
                  {t('trackingInformation')}
                </h2>
                <div className="space-y-4">
                  {trackingShipments.map((shipment, idx) => {
                    if (!shipment.tracking_number) return null;
                    return (
                      <div
                        key={`${shipment.tracking_number}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted/30 rounded-lg"
                      >
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">
                            {shipment.tracking_provider || t('carrierFallback')}
                          </p>
                          <p className="font-mono font-semibold text-foreground text-lg">
                            {shipment.tracking_number}
                          </p>
                          {shipment.date_shipped && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {t('shippedOn', { date: formatDate(shipment.date_shipped) })}
                            </p>
                          )}
                        </div>
                        <a
                          href={
                            shipment.tracking_link ||
                            getTrackingUrl(
                              shipment.tracking_provider,
                              shipment.tracking_number
                            )
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClasses('primary', 'sm')}
                        >
                          {t('trackPackage')}
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Order Items */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="heading-plain text-lg font-semibold text-foreground">{t('orderItems')}</h2>
              </div>
              <div className="divide-y divide-border">
                {order.line_items.map((item) => (
                  <div key={item.id} className="p-4 flex items-center gap-4">
                    {item.image?.src && (
                      <div className="w-16 h-16 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                        <img src={item.image.src} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{item.name}</p>
                      {item.sku && (
                        <p className="text-sm text-muted-foreground">{t('skuLabel', { sku: item.sku })}</p>
                      )}
                      <p className="text-sm text-muted-foreground">{t('qtyLabel', { qty: item.quantity })}</p>
                    </div>
                    <p className="font-semibold text-foreground">{formatPrice(item.total)}</p>
                  </div>
                ))}
              </div>

              {/* Order Summary */}
              <div className="p-4 border-t border-border bg-muted/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('subtotal')}</span>
                  <span className="text-foreground">{formatPrice(order.subtotal)}</span>
                </div>
                {parseFloat(order.discount_total) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('discount')}</span>
                    <span className="text-success">-{formatPrice(order.discount_total)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('shipping')}</span>
                  <span className="text-foreground">
                    {parseFloat(order.shipping_total) > 0 ? formatPrice(order.shipping_total) : t('free')}
                  </span>
                </div>
                {parseFloat(order.total_tax) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('tax')}</span>
                    <span className="text-foreground">{formatPrice(order.total_tax)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold pt-2 border-t border-border">
                  <span className="text-foreground">{t('total')}</span>
                  <span className="text-foreground">{formatPrice(order.total)}</span>
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Billing Address */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="heading-plain text-lg font-semibold text-foreground mb-4">{t('billingAddress')}</h2>
                <address className="not-italic text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    {order.billing.first_name} {order.billing.last_name}
                  </p>
                  {order.billing.company && <p>{order.billing.company}</p>}
                  <p>{order.billing.address_1}</p>
                  {order.billing.address_2 && <p>{order.billing.address_2}</p>}
                  <p>
                    {order.billing.city}, {order.billing.state} {order.billing.postcode}
                  </p>
                  <p>{order.billing.country}</p>
                  {order.billing.phone && <p className="pt-2">{order.billing.phone}</p>}
                  {order.billing.email && <p>{order.billing.email}</p>}
                </address>
              </div>

              {/* Shipping Address */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="heading-plain text-lg font-semibold text-foreground mb-4">{t('shippingAddress')}</h2>
                <address className="not-italic text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    {order.shipping.first_name} {order.shipping.last_name}
                  </p>
                  {order.shipping.company && <p>{order.shipping.company}</p>}
                  <p>{order.shipping.address_1}</p>
                  {order.shipping.address_2 && <p>{order.shipping.address_2}</p>}
                  <p>
                    {order.shipping.city}, {order.shipping.state} {order.shipping.postcode}
                  </p>
                  <p>{order.shipping.country}</p>
                </address>
              </div>
            </div>

            {/* Payment & Notes */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="heading-plain text-lg font-semibold text-foreground mb-4">{t('paymentInformation')}</h2>
              <p className="text-muted-foreground">
                {t.rich('paymentMethodLabel', {
                  method: order.payment_method_title,
                  strong: (chunks) => <span className="text-foreground">{chunks}</span>,
                })}
              </p>
              {order.date_paid && (
                <p className="text-muted-foreground mt-1">
                  {t.rich('paidOnLabel', {
                    date: formatDateTime(order.date_paid),
                    strong: (chunks) => <span className="text-foreground">{chunks}</span>,
                  })}
                </p>
              )}
              {order.customer_note && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-sm font-medium text-foreground mb-1">{t('orderNote')}</p>
                  <p className="text-muted-foreground">{order.customer_note}</p>
                </div>
              )}
            </div>

            {/* Help Section */}
            <div className="bg-muted/30 border border-border rounded-xl p-6 text-center">
              <h3 className="heading-plain font-semibold text-foreground mb-2">{t('needHelp')}</h3>
              <p className="text-muted-foreground mb-4">{t('needHelpBody')}</p>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 text-primary hover:text-primary-hover font-medium"
              >
                {t('contactSupport')}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </AccountLayout>
  );
}
