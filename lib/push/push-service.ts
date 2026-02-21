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
    'SELECT * FROM maleq_push_subscriptions WHERE endpoint = ? LIMIT 1',
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
): Promise<void> {
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

  if (sets.length === 0) return;
  values.push(endpoint);

  await pool.execute(
    `UPDATE maleq_push_subscriptions SET ${sets.join(', ')} WHERE endpoint = ?`,
    values
  );
}

// ── Sending ─────────────────────────────────────────────────────────

async function sendToSubscription(
  sub: DBSubscription,
  payload: PushPayload
): Promise<'ok' | 'expired' | 'error'> {
  const wp = getWebPush();

  try {
    await wp.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
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
  let query = `SELECT * FROM maleq_push_subscriptions WHERE ${prefColumn} = 1`;
  const params: (number | string)[] = [];

  // Target specific customer for order updates
  if (request.type === 'order_update' && request.customerId) {
    query += ' AND customer_id = ?';
    params.push(request.customerId);
  }

  // For back_in_stock with specific product, join stock alerts table
  if (request.type === 'back_in_stock' && request.productId) {
    query = `
      SELECT s.* FROM maleq_push_subscriptions s
      INNER JOIN maleq_stock_alert_products a ON a.subscription_id = s.id
      WHERE s.pref_back_in_stock = 1
        AND a.product_id = ?
        AND a.notified_at IS NULL
    `;
    params.length = 0;
    params.push(request.productId);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(query, params);
  const subs = rows as DBSubscription[];

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
  const BATCH_SIZE = 20;
  for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    const batch = subs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((sub) => sendToSubscription(sub, payload))
    );
    for (const r of results) {
      if (r === 'ok') result.sent++;
      else if (r === 'expired') result.expired++;
      else result.failed++;
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

  // Find products that are now in stock and have un-notified alerts
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT a.id AS alert_id, a.product_id, a.product_name, a.product_slug,
           s.id AS sub_id, s.endpoint, s.p256dh, s.auth
    FROM maleq_stock_alert_products a
    INNER JOIN maleq_push_subscriptions s ON s.id = a.subscription_id
    INNER JOIN wp_postmeta pm ON pm.post_id = a.product_id AND pm.meta_key = '_stock_status'
    WHERE a.notified_at IS NULL
      AND s.pref_back_in_stock = 1
      AND pm.meta_value = 'instock'
  `);

  const alerts = rows as Array<{
    alert_id: number;
    product_id: number;
    product_name: string;
    product_slug: string;
    sub_id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;

  for (const alert of alerts) {
    const sub: DBSubscription = {
      id: alert.sub_id,
      endpoint: alert.endpoint,
      p256dh: alert.p256dh,
      auth: alert.auth,
      customer_id: null,
      email: null,
      pref_order_updates: 0,
      pref_back_in_stock: 1,
      pref_promotions: 0,
    };

    const status = await sendToSubscription(sub, {
      title: 'Back in Stock!',
      body: `${alert.product_name} is available again.`,
      icon: '/favicon/android/android-launchericon-192-192.png',
      badge: '/favicon/favicon-32x32.png',
      tag: `stock-${alert.product_id}`,
      url: `/product/${alert.product_slug}`,
    });

    if (status === 'ok') {
      result.sent++;
      await pool.execute(
        'UPDATE maleq_stock_alert_products SET notified_at = CURRENT_TIMESTAMP WHERE id = ?',
        [alert.alert_id]
      );
    } else if (status === 'expired') {
      result.expired++;
    } else {
      result.failed++;
    }
  }

  return result;
}
