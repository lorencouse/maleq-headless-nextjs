import Image from 'next/image';
import { WooCommerceOrder } from '@/lib/woocommerce/orders';

interface OrderDetailsProps {
  order: WooCommerceOrder;
}

function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

export default function OrderDetails({ order }: OrderDetailsProps) {
  return (
    <div className="space-y-6">
      {/* Order Items */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Order Items</h2>
        </div>
        <div className="divide-y divide-border">
          {order.line_items.map((item) => (
            <div key={item.id} className="p-4 flex gap-4">
              {/* Product Image */}
              <div className="relative w-16 h-16 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                {item.image?.src ? (
                  <Image
                    src={item.image.src}
                    alt={item.name}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Product Details */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">{item.name}</p>
                {item.sku && (
                  <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
                )}
                <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
              </div>

              {/* Price */}
              <div className="text-right">
                <p className="font-medium text-foreground">{formatPrice(item.total)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Order Summary</h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-foreground">
              {formatPrice(
                order.line_items.reduce((sum, item) => sum + parseFloat(item.subtotal), 0)
              )}
            </span>
          </div>
          {parseFloat(order.discount_total) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-primary">Discount</span>
              <span className="text-primary">-{formatPrice(order.discount_total)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span className="text-foreground">
              {parseFloat(order.shipping_total) === 0 ? (
                <span className="text-primary">FREE</span>
              ) : (
                formatPrice(order.shipping_total)
              )}
            </span>
          </div>
          {parseFloat(order.total_tax) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span className="text-foreground">{formatPrice(order.total_tax)}</span>
            </div>
          )}
          <div className="pt-3 border-t border-border flex justify-between">
            <span className="font-semibold text-foreground">Total</span>
            <span className="font-bold text-foreground text-lg">{formatPrice(order.total)}</span>
          </div>
        </div>
      </div>

      {/* Shipping & Billing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Shipping Address */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Shipping Address</h2>
          </div>
          <div className="p-4 text-sm text-muted-foreground">
            <p className="text-foreground font-medium">
              {order.shipping.first_name} {order.shipping.last_name}
            </p>
            {order.shipping.company && <p>{order.shipping.company}</p>}
            <p>{order.shipping.address_1}</p>
            {order.shipping.address_2 && <p>{order.shipping.address_2}</p>}
            <p>
              {order.shipping.city}, {order.shipping.state} {order.shipping.postcode}
            </p>
            <p>{order.shipping.country}</p>
          </div>
        </div>

        {/* Billing Address */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Billing Address</h2>
          </div>
          <div className="p-4 text-sm text-muted-foreground">
            <p className="text-foreground font-medium">
              {order.billing.first_name} {order.billing.last_name}
            </p>
            {order.billing.company && <p>{order.billing.company}</p>}
            <p>{order.billing.address_1}</p>
            {order.billing.address_2 && <p>{order.billing.address_2}</p>}
            <p>
              {order.billing.city}, {order.billing.state} {order.billing.postcode}
            </p>
            <p>{order.billing.country}</p>
            {order.billing.email && <p className="mt-2">{order.billing.email}</p>}
            {order.billing.phone && <p>{order.billing.phone}</p>}
          </div>
        </div>
      </div>

      {/* Shipping Method */}
      {order.shipping_lines.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Shipping Method</h2>
          </div>
          <div className="p-4">
            {order.shipping_lines.map((shipping) => (
              <div key={shipping.id} className="flex justify-between text-sm">
                <span className="text-foreground">{shipping.method_title}</span>
                <span className="text-muted-foreground">
                  {parseFloat(shipping.total) === 0 ? 'FREE' : formatPrice(shipping.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Method */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Payment Method</h2>
        </div>
        <div className="p-4 flex items-center gap-3">
          <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <div>
            <p className="text-foreground font-medium">{order.payment_method_title}</p>
            {order.transaction_id && (
              <p className="text-xs text-muted-foreground">Transaction: {order.transaction_id}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
