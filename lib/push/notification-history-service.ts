import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPoolAsync } from '@/lib/db/pool';
import type { PushType } from '@/lib/push/types';

const TABLE_NAME = 'maleq_push_notification_history';

let ensureTablePromise: Promise<void> | null = null;

export interface PushNotificationHistoryInput {
  subscriptionId?: number | null;
  customerId?: number | null;
  type: PushType;
  title: string;
  body: string;
  url?: string | null;
  image?: string | null;
  tag?: string | null;
  productId?: number | null;
  orderId?: number | null;
}

export interface PushNotificationHistoryItem {
  id: number;
  type: PushType;
  title: string;
  body: string;
  url: string | null;
  image: string | null;
  tag: string | null;
  productId: number | null;
  orderId: number | null;
  sentAt: string;
}

interface NotificationHistoryRow extends RowDataPacket {
  id: number;
  push_type: PushType;
  title: string;
  body: string;
  url: string | null;
  image: string | null;
  tag: string | null;
  product_id: number | null;
  order_id: number | null;
  sent_at: string;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeOptionalString(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return truncate(trimmed, maxLength);
}

async function ensureNotificationHistoryTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const pool = await getPoolAsync();
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          subscription_id BIGINT UNSIGNED NULL,
          customer_id BIGINT UNSIGNED NULL,
          push_type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          body VARCHAR(500) NOT NULL,
          url VARCHAR(2048) NULL,
          image VARCHAR(2048) NULL,
          tag VARCHAR(255) NULL,
          product_id BIGINT UNSIGNED NULL,
          order_id BIGINT UNSIGNED NULL,
          sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_customer_sent (customer_id, sent_at),
          KEY idx_subscription_sent (subscription_id, sent_at),
          KEY idx_type_sent (push_type, sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const createDenied =
        code === 'ER_TABLEACCESS_DENIED_ERROR' ||
        code === 'ER_DBACCESS_DENIED_ERROR' ||
        code === 'ER_ACCESS_DENIED_ERROR';
      if (!createDenied) throw error;

      await pool.query(`SELECT 1 FROM ${TABLE_NAME} LIMIT 1`);
    }
  })();

  try {
    await ensureTablePromise;
  } catch (error) {
    ensureTablePromise = null;
    throw error;
  }
}

export async function recordPushNotificationHistory(
  notifications: PushNotificationHistoryInput[]
): Promise<void> {
  if (notifications.length === 0) return;

  await ensureNotificationHistoryTable();
  const pool = await getPoolAsync();

  const values: Array<number | string | null> = [];
  const placeholders: string[] = [];

  for (const notification of notifications) {
    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    values.push(
      notification.subscriptionId ?? null,
      notification.customerId ?? null,
      notification.type,
      truncate(notification.title, 255),
      truncate(notification.body, 500),
      normalizeOptionalString(notification.url, 2048),
      normalizeOptionalString(notification.image, 2048),
      normalizeOptionalString(notification.tag, 255),
      notification.productId ?? null,
      notification.orderId ?? null
    );
  }

  await pool.execute<ResultSetHeader>(
    `INSERT INTO ${TABLE_NAME}
      (subscription_id, customer_id, push_type, title, body, url, image, tag, product_id, order_id)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

export async function getCustomerPushNotificationHistory(
  customerId: number,
  limit: number
): Promise<PushNotificationHistoryItem[]> {
  await ensureNotificationHistoryTable();
  const pool = await getPoolAsync();

  const [rows] = await pool.query<NotificationHistoryRow[]>(
    `SELECT
      id,
      push_type,
      title,
      body,
      url,
      image,
      tag,
      product_id,
      order_id,
      sent_at
     FROM ${TABLE_NAME}
     WHERE customer_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [customerId, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.push_type,
    title: row.title,
    body: row.body,
    url: row.url,
    image: row.image,
    tag: row.tag,
    productId: row.product_id,
    orderId: row.order_id,
    sentAt: row.sent_at,
  }));
}
