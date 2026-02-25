import { getPoolAsync } from '@/lib/db/pool';
import { getWebPush } from './web-push-config';
import type {
  PushSubscriptionData,
  NotificationPreferences,
  PushPayload,
  PushType,
  SendPushRequest,
  SendResult,
  StockAlertProduct,
  DBSubscription,
} from './types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { recordPushNotificationHistory } from '@/lib/push/notification-history-service';

// ── Subscription CRUD ───────────────────────────────────────────────

export async function saveSubscription(data: PushSubscriptionData): Promise<void> {
  const pool = await getPoolAsync();
  await pool.execute(
    `INSERT INTO maleq_push_subscriptions
       (endpoint, p256dh, auth, customer_id, email, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       p256dh = VALUES(p256dh),
       auth = VALUES(auth),
       customer_id = COALESCE(VALUES(customer_id), customer_id),
       email = COALESCE(VALUES(email), email),
       user_agent = VALUES(user_agent),
       updated_at = CURRENT_TIMESTAMP`,
    [data.endpoint, data.keys.p256dh, data.keys.auth, data.customerId ?? null, data.email ?? null, data.userAgent ?? null]
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const pool = await getPoolAsync();
  await pool.execute('DELETE FROM maleq_push_subscriptions WHERE endpoint = ?', [endpoint]);
}

export async function getSubscriptionByEndpoint(endpoint: string): Promise<DBSubscription | null> {
  const pool = await getPoolAsync();
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, endpoint, p256dh, auth, customer_id, email, pref_order_updates, pref_back_in_stock, pref_promotions FROM maleq_push_subscriptions WHERE endpoint = ? LIMIT 1',
    [endpoint]
  );
  return (rows[0] as DBSubscription) ?? null;
}

// ── Preferences ─────────────────────────────────────────────────────

export async function getPreferences(endpoint: string): Promise<NotificationPreferences | null> {
  const sub = await getSubscriptionByEndpoint(endpoint);
  if (!sub) return null;
  return {
    orderUpdates: sub.pref_order_updates === 1,
    backInStock: sub.pref_back_in_stock === 1,
    promotions: sub.pref_promotions === 1,
  };
}

export async function updatePreferences(
  endpoint: string,
  prefs: Partial<NotificationPreferences>
): Promise<boolean> {
  const pool = await getPoolAsync();
  const sets: string[] = [];
  const values: (number | string)[] = [];

  if (prefs.orderUpdates !== undefined) {
    sets.push('pref_order_updates = ?');
    values.push(prefs.orderUpdates ? 1 : 0);
  }
  if (prefs.backInStock !== undefined) {
    sets.push('pref_back_in_stock = ?');
    values.push(prefs.backInStock ? 1 : 0);
  }
  if (prefs.promotions !== undefined) {
    sets.push('pref_promotions = ?');
    values.push(prefs.promotions ? 1 : 0);
  }

  if (sets.length === 0) return true;
  values.push(endpoint);

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE maleq_push_subscriptions SET ${sets.join(', ')} WHERE endpoint = ?`,
    values
  );

  return result.affectedRows > 0;
}

// ── Sending ─────────────────────────────────────────────────────────

async function sendToSubscription(
  sub: Pick<DBSubscription, 'id' | 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload
): Promise<'ok' | 'expired' | 'error'> {
  const wp = getWebPush();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://maleq.com';

  // Build payload that includes both our custom fields (for SW handler)
  // and the Declarative Web Push format (for iOS 18.4+ / Safari 18.4+).
  // The "web_push" + "notification" fields let the browser display the
  // notification natively without requiring SW JavaScript.
  const navigateUrl = (payload.url || '/').startsWith('http')
    ? payload.url!
    : `${siteUrl}${payload.url || '/'}`;

  const fullPayload = {
    ...payload,
    web_push: 8030,
    notification: {
      title: payload.title,
      body: payload.body,
      navigate: navigateUrl,
      silent: false,
      app_badge: '1',
    },
  };

  try {
    await wp.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(fullPayload)
    );
    return 'ok';
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription expired / unsubscribed — clean up
      await deleteSubscription(sub.endpoint);
      return 'expired';
    }
    console.error('Push send error:', sub.endpoint, err);
    return 'error';
  }
}

export async function sendByType(request: SendPushRequest): Promise<SendResult> {
  const pool = await getPoolAsync();
  const result: SendResult = { sent: 0, failed: 0, expired: 0 };

  const prefColumn = getPrefColumn(request.type);
  let query = `SELECT id, endpoint, p256dh, auth, customer_id FROM maleq_push_subscriptions WHERE ${prefColumn} = 1`;
  const params: (number | string)[] = [];

  // Target specific customer for order updates
  if (request.type === 'order_update' && request.customerId) {
    query += ' AND customer_id = ?';
    params.push(request.customerId);
  }

  // For back_in_stock with specific product, join stock alerts table
  if (request.type === 'back_in_stock' && request.productId) {
    query = `
      SELECT s.id, s.endpoint, s.p256dh, s.auth, s.customer_id FROM maleq_push_subscriptions s
      INNER JOIN maleq_stock_alert_products a ON a.subscription_id = s.id
      WHERE s.pref_back_in_stock = 1
        AND a.product_id = ?
        AND a.notified_at IS NULL
    `;
    params.length = 0;
    params.push(request.productId);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(query, params);
  const subs = rows as Pick<DBSubscription, 'id' | 'endpoint' | 'p256dh' | 'auth' | 'customer_id'>[];

  const payload: PushPayload = {
    title: request.title,
    body: request.body,
    icon: '/favicon/android/android-launchericon-192-192.png',
    badge: '/favicon/favicon-32x32.png',
    tag: request.type,
    url: request.url || '/',
    image: request.image,
  };

  // Send in parallel with concurrency limit
  const BATCH_SIZE = 50;
  for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    const batch = subs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((sub) => sendToSubscription(sub, payload))
    );
    const historyRows: Array<{
      subscriptionId: number;
      customerId: number;
      type: SendPushRequest['type'];
      title: string;
      body: string;
      url: string;
      image?: string;
      tag: string;
      productId?: number;
      orderId?: number;
    }> = [];
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const sub = batch[j];
      if (r === 'ok') {
        result.sent++;
        if (sub.customer_id) {
          historyRows.push({
            subscriptionId: sub.id,
            customerId: sub.customer_id,
            type: request.type,
            title: payload.title,
            body: payload.body,
            url: payload.url || '/',
            image: payload.image,
            tag: payload.tag || request.type,
            productId: request.type === 'back_in_stock' ? request.productId : undefined,
            orderId: request.type === 'order_update' ? request.orderId : undefined,
          });
        }
      } else if (r === 'expired') {
        result.expired++;
      } else {
        result.failed++;
      }
    }
    if (historyRows.length > 0) {
      await recordPushNotificationHistory(historyRows).catch((error) => {
        console.error('Failed to record push notification history:', error);
      });
    }
  }

  return result;
}

function getPrefColumn(type: PushType): string {
  switch (type) {
    case 'order_update': return 'pref_order_updates';
    case 'back_in_stock': return 'pref_back_in_stock';
    case 'promotion': return 'pref_promotions';
  }
}

// ── Stock Alerts ────────────────────────────────────────────────────

export async function saveStockAlert(
  endpoint: string,
  product: StockAlertProduct
): Promise<void> {
  const pool = await getPoolAsync();

  // Get subscription ID from endpoint
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM maleq_push_subscriptions WHERE endpoint = ? LIMIT 1',
    [endpoint]
  );
  const sub = rows[0] as { id: number } | undefined;
  if (!sub) throw new Error('Subscription not found');

  await pool.execute(
    `INSERT INTO maleq_stock_alert_products
       (subscription_id, product_id, product_name, product_slug)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       product_name = VALUES(product_name),
       product_slug = VALUES(product_slug)`,
    [sub.id, product.productId, product.productName, product.productSlug]
  );
}

export async function deleteStockAlert(endpoint: string, productId: number): Promise<void> {
  const pool = await getPoolAsync();
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM maleq_push_subscriptions WHERE endpoint = ? LIMIT 1',
    [endpoint]
  );
  const sub = rows[0] as { id: number } | undefined;
  if (!sub) return;

  await pool.execute(
    'DELETE FROM maleq_stock_alert_products WHERE subscription_id = ? AND product_id = ?',
    [sub.id, productId]
  );
}

export async function checkAndNotifyStockAlerts(): Promise<SendResult> {
  const pool = await getPoolAsync();
  const result: SendResult = { sent: 0, failed: 0, expired: 0 };

  // Atomically claim un-notified alerts for products now in stock
  // This prevents duplicate sends if two cron invocations run concurrently
  const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.execute<ResultSetHeader>(`
    UPDATE maleq_stock_alert_products a
    INNER JOIN maleq_push_subscriptions s ON s.id = a.subscription_id AND s.pref_back_in_stock = 1
    INNER JOIN wp_postmeta pm ON pm.post_id = a.product_id AND pm.meta_key = '_stock_status'
    SET a.notified_at = CURRENT_TIMESTAMP, a.product_slug = CONCAT(a.product_slug, '|', ?)
    WHERE a.notified_at IS NULL
      AND pm.meta_value = 'instock'
  `, [claimId]);

  // Now fetch the alerts we just claimed
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT a.id AS alert_id, a.product_id, a.product_name,
           SUBSTRING_INDEX(a.product_slug, '|', 1) AS product_slug,
           s.id AS sub_id, s.customer_id, s.endpoint, s.p256dh, s.auth
    FROM maleq_stock_alert_products a
    INNER JOIN maleq_push_subscriptions s ON s.id = a.subscription_id
    WHERE a.product_slug LIKE CONCAT('%|', ?)
  `, [claimId]);

  // Clean up the claim marker from product_slug
  await pool.execute(`
    UPDATE maleq_stock_alert_products
    SET product_slug = SUBSTRING_INDEX(product_slug, '|', 1)
    WHERE product_slug LIKE CONCAT('%|', ?)
  `, [claimId]);

  const alerts = rows as Array<{
    alert_id: number;
    product_id: number;
    product_name: string;
    product_slug: string;
    sub_id: number;
    customer_id: number | null;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;

  // Send in batches
  const BATCH_SIZE = 50;
  for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
    const batch = alerts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((alert) =>
        sendToSubscription(
          { id: alert.sub_id, endpoint: alert.endpoint, p256dh: alert.p256dh, auth: alert.auth },
          {
            title: 'Back in Stock!',
            body: `${alert.product_name} is available again.`,
            icon: '/favicon/android/android-launchericon-192-192.png',
            badge: '/favicon/favicon-32x32.png',
            tag: `stock-${alert.product_id}`,
            url: `/product/${alert.product_slug}`,
          }
        )
      )
    );
    const historyRows: Array<{
      subscriptionId: number;
      customerId: number;
      type: SendPushRequest['type'];
      title: string;
      body: string;
      url: string;
      tag: string;
      productId: number;
    }> = [];

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r === 'ok') {
        result.sent++;
        const alert = batch[j];
        if (alert.customer_id) {
          historyRows.push({
            subscriptionId: alert.sub_id,
            customerId: alert.customer_id,
            type: 'back_in_stock',
            title: 'Back in Stock!',
            body: `${alert.product_name} is available again.`,
            url: `/product/${alert.product_slug}`,
            tag: `stock-${alert.product_id}`,
            productId: alert.product_id,
          });
        }
      } else if (r === 'expired') {
        result.expired++;
        // Clear notified_at so if they re-subscribe, they can get notified again
      } else {
        result.failed++;
        // Send failed — reset notified_at so it can be retried
        await pool.execute(
          'UPDATE maleq_stock_alert_products SET notified_at = NULL WHERE id = ?',
          [batch[j].alert_id]
        );
      }
    }
    if (historyRows.length > 0) {
      await recordPushNotificationHistory(historyRows).catch((error) => {
        console.error('Failed to record push notification history:', error);
      });
    }
  }

  return result;
}
