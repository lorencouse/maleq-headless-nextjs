export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  customerId?: number;
  email?: string;
  userAgent?: string;
}

export interface NotificationPreferences {
  orderUpdates: boolean;
  backInStock: boolean;
  promotions: boolean;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  image?: string;
}

export type PushType = 'order_update' | 'back_in_stock' | 'promotion';

export interface SendPushRequest {
  type: PushType;
  title: string;
  body: string;
  url?: string;
  image?: string;
  /** For order_update: the customer ID to target */
  customerId?: number;
  /** For back_in_stock: the product ID */
  productId?: number;
}

export interface SendResult {
  sent: number;
  failed: number;
  expired: number;
}

export interface StockAlertProduct {
  productId: number;
  productName: string;
  productSlug: string;
}

export interface DBSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  customer_id: number | null;
  email: string | null;
  pref_order_updates: number;
  pref_back_in_stock: number;
  pref_promotions: number;
}
